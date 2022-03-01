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
interface TrackedSocket extends Socket {
  gracefulExitId?: string;
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
  private _gracefulExitHandlerCallTime = 0;
  private serverCallClosedStarted = false;
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
    return this._gracefulExitHandlerCallTime;
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
    _options: Configuration = {},
  ): Promise<void> {
    // This promise is not awaited so we must catch exceptions
    try {
      // Record when this function was called so we can reduce the wait time on the min delays
      // if all sockets are closed quickly
      this._gracefulExitHandlerCallTime = Date.now();

      // Signal the Express middleware to start responding with `connection: close` headers
      this._draining = true;

      // Merge the default options and passed-in options
      this._options = _.defaults(_options, DefaultOptions);

      // If a logger was passed it's implied that log should be true if not specified
      if (_options.logger !== undefined && _options.log === undefined) {
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
      if (_options.suicideTimeout !== undefined) {
        // @ts-expect-error allow overwriting this renamed option
        this._options.hardExitTimeout = _options.suicideTimeout;
      }
      if (_options.force !== undefined) {
        // @ts-expect-error allow overwriting this renamed option
        this._options.destroySocketsOnHardExit = _options.force;
      }

      // Check for unnecessary connection tracking
      if (!this._options.destroySocketsOnHardExit && this.trackingSockets) {
        console.error(
          'Connection tracking is enabled but `destroySocketsOnHardExit` is `false`. Connection tracking is only needed when `destroySocketsOnHardExit` is `true`.',
        );
      }
      // Check for necessary but missing connection tracking
      if (this._options.destroySocketsOnHardExit && !this.trackingSockets) {
        console.error(
          'Connection tracking is not enabled but `destroySocketsOnHardExit` is `true`. Connection tracking is required when `destroySocketsOnHardExit` is `true`.',
        );
      }

      if (
        this._options.serverCloseMinDelay !== undefined &&
        this._options.serverCloseMinDelay >= this._options.serverCloseMaxDelay
      ) {
        console.error(
          '`serverCloseMinDelay` cannot be greater than or equal to `serverCloseMaxDelay`.',
        );
      }

      if (this._options.errorDuringExit === false && this._options.performLastRequest === false) {
        console.error(
          '`errorDuringExit` and `performLastRequest` are both `false`, routes will not run but will respond with a `200`.',
        );
      }

      const getConnectionsAsync = promisify(server.getConnections.bind(server));

      if (this._options.serverCloseMinDelay !== undefined) {
        // Min close delay has been set and time has not been reached yet
        // Wait until min close delay has been reached
        await sleep(this._options.serverCloseMinDelay);
      }

      // Start looping until we shutdown
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const shutdownDurationMs = Date.now() - this._gracefulExitHandlerCallTime;
        const connectionCount = await getConnectionsAsync();

        if (connectionCount === 0) {
          break;
        }

        if (
          shutdownDurationMs > this._options.serverCloseMaxDelay ||
          shutdownDurationMs > this._options.hardExitTimeout
        ) {
          break;
        }

        await sleep(100);
      }

      // Initiate the server close
      await this.callServerClose(server);
    } catch (error: any) {
      console.error(`Unexpected exception during shutdown loop: ${error.message}`);
    }
  }

  private disconnectSocketIOClients(): void {
    if (this._options.socketio === undefined) {
      throw new Error('`disconnectSocketIOClients` called but `options.socketio` is undefined');
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
    if (this.serverCallClosedStarted) {
      return;
    }
    this.serverCallClosedStarted = true;

    const shutdownDurationMs = Date.now() - this._gracefulExitHandlerCallTime;

    // Hard exit will happen if `server.close` does not return in time due
    // to some sockets still being open
    this.hardExitTimer = setTimeout(
      () => void this.hardExitHandler(),
      Math.max(0, this._options.hardExitTimeout - shutdownDurationMs),
    );

    this.logger("Closing down the http server's listening socket");

    // server.close immediately closes the listening socket, causing any further connection attempts,
    // including for healthchecks, to be refused.
    await promisify(server.close.bind(server))();
    // This callback is only called when the last connection to the server is closed

    // Disconnect all the socket.io clients
    if (this._options.socketio) {
      this.disconnectSocketIOClients();
    }

    // Everything was closed successfully, mission accomplished!
    this.connectionsClosed = true;

    this.logger('No longer accepting connections');

    // Exit if the hard exit timer didn't already
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
    const connection = (req.socket || {}) as TrackedSocket;

    // Track whether last rquest has started
    connection.lastRequestStarted = connection.lastRequestStarted ?? false;

    // Set connection close header on response
    // This tells the caller that the connection will be closed after they read the response
    res.set('Connection', 'close');

    if (this._options.performLastRequest && connection.lastRequestStarted === false) {
      this.logger('Server exiting, performing last request for this connection.');

      connection.lastRequestStarted = true;
      return next();
    }

    if (this._options.errorDuringExit) {
      this.logger('Server unavailable, incoming request rejected with error.');

      return next(
        (this._options.getRejectionError !== undefined && this._options.getRejectionError()) ||
          (DefaultOptions.getRejectionError !== undefined &&
            DefaultOptions.getRejectionError(
              new Error('Server unavailable, no new requests accepted during shutdown'),
            )),
      );
    }

    // Silently drop request without response (existing deprecated behavior)
    this.logger('Server unavailable, incoming request dropped silently.');

    // Intentionally do NOT call next()
    // Calling next will cause the request logic to run and it may run to completion
    // if there are other open incoming sockets that cause server.close() to not return
    // immediately
    res.end();
  }

  public trackingSocketsStarted(): void {
    this.trackingSockets = true;
  }

  public trackSocketOpen(socket: TrackedSocket): void {
    // FID is not exposed so we have to generate an ID just like socket.io does
    socket.gracefulExitId = base64id.generateId();
    this.sockets[socket.gracefulExitId] = socket;
    this._socketCount++;
  }

  public trackSocketClose(socket: TrackedSocket): void {
    if (socket.gracefulExitId === undefined || this.sockets[socket.gracefulExitId] === undefined) {
      return;
    }

    // Remove the socket from tracking
    delete this.sockets[socket.gracefulExitId];
    this._socketCount--;
  }
}
