import { NextFunction, Request, Response } from 'express';
import { Socket } from 'net';
import http from 'http';
import _ from 'underscore';
import base64id from 'base64id';
import { SocketIOSocket } from './socketio';
import { Configuration, DefaultOptions, RequiredConfiguration } from './configuration';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

/**
 * Declare the extra property that we add to each incoming Express Socket during graceful exit
 */
interface GracefulTracker extends Socket {
  trackerId?: string;
  lastRequestStarted?: boolean;
}

export class RejectionError extends Error {
  constructor(m: string) {
    super(m);

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, RejectionError.prototype);
  }
  public readonly name: string = 'RejectionError';
  public status: number | undefined;
  public statusCode: number | undefined;
  public statusMessage: string | undefined;
  public headers: { [key: string]: string } = {};
}

export class Middleware {
  private exitRequestedDate = 0;
  private serverClosedOnce = false;
  private sockets: { [id: string]: Socket } = {};
  private _socketCount = 0;
  private _options: RequiredConfiguration = DefaultOptions;
  private hardExitTimer: NodeJS.Timeout | undefined;
  private connectionsClosed = false;
  private _draining = false;
  private trackingSockets = false;
  private exitCalled = false;

  public get draining(): boolean {
    return this._draining;
  }

  public get gracefulExitHandlerCallTime(): number {
    return this.exitRequestedDate;
  }

  public get options(): RequiredConfiguration {
    // Make a copy so it's not modified
    return { ...this._options };
  }

  public get socketCount(): number {
    return this._socketCount;
  }

  constructor() {
    this.hardExitHandler = this.hardExitHandler.bind(this);
  }

  public logger(str: string): void {
    if (this._options.log && this._options.logger !== undefined) {
      this._options.logger(str);
    }
  }

  public async initiateGracefulExit(
    server: http.Server,
    options: Configuration = {},
  ): Promise<void> {
    // This promise is not awaited so we must catch exceptions
    try {
      // Record when this function was called to more accurately follow specified timer options
      this.exitRequestedDate = Date.now();

      // Signal the Express middleware to start responding with `connection: close` headers
      this._draining = true;

      // Merge the default options and passed-in options
      this._options = _.defaults(options, DefaultOptions);

      // If a logger was passed it's implied that log should be true if not specified
      if (options.logger != null && options.log == null) {
        // @ts-expect-error allow overwriting this option
        this._options.log = true;
      }

      // Logger works after options are assigned
      this.logger('Initiating graceful exit');

      if (this._options.callback) {
        if (!_.isFunction(this._options.callback)) {
          this.logger('Ignoring callback option that is not a function');
        } else if (this._options.exitProcess) {
          this.logger(`Callback has ${this._options.exitDelay} ms to complete before hard exit`);
        }
      }

      // Handle renamed options
      if (this._options.hardExitTimeout == null) { 
        // @ts-expect-error allow overwriting this renamed option
        this._options.hardExitTimeout = options.suicideTimeout;
      }
      if (this._options.destroySocketsOnHardExit == null) {
        // @ts-expect-error allow overwriting this renamed option
        this._options.destroySocketsOnHardExit = options.force;
      }

      // Check for unnecessary connection tracking
      if (!this._options.destroySocketsOnHardExit && this.trackingSockets) {
        console.warn(
          'Connection tracking is enabled but is only done if `destroySocketsOnHardExit` is `true`. Ignoring flag',
        );
      }
      // Check for necessary but missing connection tracking
      if (this._options.destroySocketsOnHardExit && !this.trackingSockets) {
        console.error(
          'Connection tracking inactive but `destroySocketsOnHardExit` is `true`. Not tracking',
        );
      }

      if (
        this._options.serverCloseMinDelay !== undefined &&
        this._options.serverCloseMinDelay > this._options.serverCloseMaxDelay
      ) {
        console.warn(
          `Since min is larger than the max, setting serverCloseMinDelay to serverCloseMaxDelay`
        );
        this._options.serverCloseMinDelay = this._options.serverCloseMaxDelay;
      }

      if (this._options.errorDuringExit === false && this._options.performLastRequest === false) {
        console.error(
          '`errorDuringExit` and `performLastRequest` both `false`, requests ignored yet respond with a `200`',
        );
      }

      const getConnectionsAsync = promisify(server.getConnections.bind(server));

      if (this._options.serverCloseMinDelay !== undefined) {
        // Min close delay has been set and time has not been reached yet
        // Wait until min close delay has been reached
        const remainingMinDelay = this._options.serverCloseMinDelay - 
        await sleep();
      }

      // Loop until we should shutdown
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const msSinceExitRequested = Date.now() - this.exitRequestedDate;
        const connectionCount = await getConnectionsAsync();

        if (
          connectionCount <= 0 ||
          msSinceExitRequested > this._options.serverCloseMaxDelay ||
          msSinceExitRequested > this._options.hardExitTimeout
        ) {
          break;
        }

        await sleep(50);
      }

      // Initiate the server close
      await this.callServerClose(server);
    } catch (error: any) {
      console.error(`Unexpected exception during shutdown loop: ${error}`);
    }
  }

  private disconnectSocketIOClients(): void {
    if (this._options.socketio?.sockets == null) {
      throw new Error('`disconnectSocketIOClients` called but `options.socketio` is invalid');
    }

    const sockets = this._options.socketio.sockets;
    let connectedSockets: SocketIOSocket[] | undefined;
    if (typeof sockets?.sockets === 'object' && !Array.isArray(sockets.sockets)) {
      // socket.io 1.4+
      connectedSockets = _.values(sockets.sockets);
    } else if (sockets.sockets && sockets.sockets.length) {
      // socket.io 1.0-1.3
      connectedSockets = sockets.sockets; 
    } else if (typeof sockets.clients === 'function') {
      // socket.io 0.x
      connectedSockets = sockets.clients();
    }
    if (typeof this._options.socketio.close === 'function') {
      this._options.socketio.close();
    }

    if (connectedSockets && connectedSockets.length) {
      this.logger(`Killing ${connectedSockets.length} socket.io sockets`);
      connectedSockets.forEach(function (socket) {
        socket.disconnect();
      });
    }
  }

  private async callServerClose(server: http.Server): Promise<void> {
    if (this.serverClosedOnce) {
      return;
    }
    this.serverClosedOnce = true;

    const msSinceExitRequested = Date.now() - this.exitRequestedDate;

    if (this.options.exitProcess) {
      // Hard exit if `server.close` does not return before the user specified time limit
      const remainingHardExitDelay = Math.max(0, this._options.hardExitTimeout - msSinceExitRequested);
      this.hardExitTimer = setTimeout(
        () => void this.hardExitHandler(),
        remainingHardExitDelay
      );
    }

    this.logger("Closing down the http server's listening socket");

    // server.close closes the listening socket now, all future incoming requests are ignored
    await promisify(server.close.bind(server))();
    this.logger('No longer accepting connections');
    
    // Disconnect all the socket.io clients
    if (this._options.socketio) {
      this.disconnectSocketIOClients();
    }

    // Everything was closed successfully, mission accomplished!
    this.connectionsClosed = true;
  
    // if a hard exit occurs this never runs
    await this.exit(0);
  }

  private async exit(code: number): Promise<void> {
    if (this.exitCalled) {
      return;
    }
    this.exitCalled = true;

    if (_.isFunction(this._options.callback)) {
      this._options.callback(code);
    }

    if (this.hardExitTimer !== undefined) {
      clearTimeout(this.hardExitTimer);
      delete this.hardExitTimer;
    }

    if (this._options.exitProcess) {
      this.logger(`Exiting process with code: ${code}`);
      // leave a bit of time to write logs, callback to complete, etc
      await sleep(this._options.exitDelay);
      process.exit(code);
    }
  }

  private async hardExitHandler(): Promise<void> {
    if (this.connectionsClosed) {
      // this condition should never occur, see serverClosedCallback() below.
      // the user callback, if any, has already been called
      if (this._options.exitProcess) {
        process.exit(1);
      }
      return;
    }

    if (this._options.destroySocketsOnHardExit) {
      const socketKeys = Object.keys(this.sockets);
      this.logger(`Destroying ${socketKeys.length} open sockets`);

      socketKeys.forEach((id) => {
        const socket = this.sockets[id];
        socket.destroy();
      });
    } else {
      this.logger('Hard exit timer ran out before some connections closed');
    }

    await this.exit(1);
  }

  public handleFinalRequests(req: Request, res: Response, next: NextFunction): void {
    const connection = (req.socket || {}) as GracefulTracker;

    // Track whether final rquest has started
    connection.lastRequestStarted = connection.lastRequestStarted ?? false;

    // Set connection close header on response
    // This informs the caller that the connection is closing and will not accept more requests
    res.set('Connection', 'close');

    if (this._options.performLastRequest && connection.lastRequestStarted === false) {
      this.logger('Server exiting, performing last request for this connection.');

      connection.lastRequestStarted = true;
      return next();
    }

    if (this._options.errorDuringExit) {
      this.logger('Server unavailable, incoming request rejected with error.');

      const rejectionError = this._options?.getRejectionError() ||
        DefaultOptions.getRejectionError(
          'Server unavailable, no new requests accepted during shutdown'
        );
      return next(rejectionError);
    }

    // Configured to silently drop request without response (deprecated behavior)
    this.logger('Server unavailable, incoming request dropped silently.');

    // Intentionally NOT calling next(), to avoid interference with socket.close()
    res.end();
  }

  public trackingSocketsStarted(): void {
    this.trackingSockets = true;
  }

  public trackSocketOpen(socket: GracefulTracker): void {
    // FID is not exposed so we have to generate an ID just like socket.io does
    socket.trackerId = base64id.generateId();
    this.sockets[socket.trackerId] = socket;
    this._socketCount++;
  }

  public trackSocketClose(socket: GracefulTracker): void {
    if (socket.trackerId === undefined || this.sockets[socket.trackerId] === undefined) {
      return;
    }

    // Remove the socket from tracking
    delete this.sockets[socket.trackerId];
    this._socketCount--;
  }
}