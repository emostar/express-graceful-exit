import { Server, Socket } from 'net';
import { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import _ from 'underscore';
import { inspect } from 'util';

export interface Configuration {
  errorDuringExit?: boolean;
  performLastRequest?: boolean;
  callback?: (code: number) => void;
  log?: boolean;
  logger?: (message: string) => void;
  getRejectionError?: (error?: Error) => Error | undefined;
  suicideTimeout?: number;
  exitProcess?: boolean;
  exitDelay?: number;
  force?: boolean;
  socketio?: unknown;
}

const sockets: Socket[] = [];
let options: Configuration = {};
let hardExitTimer: NodeJS.Timeout | undefined;
let connectionsClosed = false;

const defaultOptions: Configuration = {
  errorDuringExit: false, // false is existing behavior, deprecated as of v0.5.0
  performLastRequest: false, // false is existing behavior, deprecated as of v0.5.0
  log: false,
  logger: console.log,
  getRejectionError: (err?: Error): Error | undefined => {
    return err;
  },
  suicideTimeout: 2 * 60 * 1000 + 10 * 1000, // 2m10s (nodejs default is 2m)
  exitProcess: true,
  exitDelay: 10, // wait in ms before process.exit, if exitProcess true
  force: false,
};

function logger(str: string) {
  if (options.log && options.logger !== undefined) {
    options.logger(str);
  }
}

/**
 * Track open connections to forcibly close sockets if and when the hard exit handler runs
 * @param server HTTP server
 */
export function init(server: Server): void {
  server.on('connection', (socket: Socket) => {
    sockets.push(socket);

    socket.on('close', function () {
      sockets.splice(sockets.indexOf(socket), 1);
    });
  });
}

function disconnectSocketIOClients(): void {
  const sockets = options.socketio?.sockets;
  let connectedSockets: Socket[];
  if (typeof sockets.sockets === 'object' && !Array.isArray(sockets.sockets)) {
    // socket.io 1.4+
    connectedSockets = _.values(sockets.sockets);
  } else if (sockets.sockets && sockets.sockets.length) {
    // socket.io 1.0-1.3
    connectedSockets = sockets.sockets;
  } else if (typeof sockets.clients === 'function') {
    // socket.io 0.x
    connectedSockets = sockets.clients();
  }
  if (typeof options.socketio.close === 'function') {
    options.socketio.close();
  }
  if (connectedSockets && connectedSockets.length) {
    logger('Killing ' + connectedSockets.length + ' socket.io sockets');
    connectedSockets.forEach(function (socket) {
      socket.disconnect();
    });
  }
}

function exit(code: number) {
  if (hardExitTimer === null) {
    return; // server.close has finished, don't callback/exit twice
  }
  if (_.isFunction(options.callback)) {
    options.callback(code);
  }
  if (options.exitProcess) {
    logger('Exiting process with code ' + code);
    // leave a bit of time to write logs, callback to complete, etc
    setTimeout(function () {
      process.exit(code);
    }, options.exitDelay);
  }
}

function hardExitHandler(): void {
  if (connectionsClosed) {
    // this condition should never occur, see serverClosedCallback() below.
    // the user callback, if any, has already been called
    if (options.exitProcess) {
      process.exit(1);
    }
    return;
  }
  if (options.force) {
    sockets = sockets || [];
    logger('Destroying ' + sockets.length + ' open sockets');
    sockets.forEach(function (socket) {
      socket.destroy();
    });
  } else {
    logger('Suicide timer ran out before some connections closed');
  }
  exit(1);
  hardExitTimer = undefined;
}

export function gracefulExitHandler(
  app: Express,
  server: Server,
  _options: Configuration = {},
): void {
  options = _.defaults(_options, defaultOptions);
  if (options.callback) {
    if (!_.isFunction(options.callback)) {
      logger('Ignoring callback option that is not a function');
    } else if (options.exitProcess) {
      logger('Callback has ' + options.exitDelay + 'ms to complete before hard exit');
    }
  }
  logger('Closing down the http server');

  // Let everything know that we wish to exit gracefully
  app.set('graceful_exit', true);

  // Time to stop accepting new connections
  server.close(function serverClosedCallback() {
    // Everything was closed successfully, mission accomplished!
    connectionsClosed = true;

    logger('No longer accepting connections');
    exit(0);

    if (hardExitTimer !== undefined) {
      clearTimeout(hardExitTimer); // must be cleared after calling exit()
      hardExitTimer = undefined;
    }
  });

  // Disconnect all the socket.io clients
  if (options.socketio) {
    disconnectSocketIOClients();
  }

  // If any connections linger past the suicide timeout, exit the process.
  // When this fires we've run out of time to exit gracefully.
  hardExitTimer = setTimeout(hardExitHandler, options.suicideTimeout);
}

function handleFinalRequests(req: Request, res: Response, next: NextFunction): void {
  const headers = inspect(req.headers) || '?'; // safe object to string
  const connection = req.socket || {};

  if (options.performLastRequest && connection.lastRequestStarted === false) {
    logger('Server exiting, performing last request for this connection. Headers: ' + headers);

    connection.lastRequestStarted = true;
    return next();
  }

  if (options.errorDuringExit) {
    logger('Server unavailable, incoming request rejected with error. Headers: ' + headers);

    return next(
      (options.getRejectionError !== undefined && options.getRejectionError()) ||
        (defaultOptions.getRejectionError !== undefined &&
          defaultOptions.getRejectionError(
            new Error('Server unavailable, no new requests accepted during shutdown'),
          )),
    );
  }

  // else silently drop request without response (existing deprecated behavior)
  logger('Server unavailable, incoming request dropped silently. Headers: ' + headers);

  res.end(); // end request without calling next()
  return undefined;
}

/**
 * Express middleware that sets the `connection: close` response header when in `graceful_exit` mode
 *
 * @param app Express application
 * @returns
 */
export function middleware(app: Express): RequestHandler {
  // This flag is used to signal the below middleware when the server wants to stop.
  app.set('graceful_exit', false);

  return function checkIfExitingGracefully(req: Request, res: Response, next: NextFunction) {
    if (app.settings.graceful_exit === false) {
      return next();
    }

    const connection = req.socket || {};
    connection.lastRequestStarted = connection.lastRequestStarted || false;

    // Set connection closing header for response, if any. Fix to issue 14, thank you HH
    res.set('Connection', 'close');

    return handleFinalRequests(req, res, next);
  };
}
