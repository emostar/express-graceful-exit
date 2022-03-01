import { Socket } from 'net';
import http from 'http';
import { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { Configuration } from './configuration';
import { Middleware } from './middleware';

/**
 * @deprecated 2022-02-25 - Renamed to `trackConnections`
 *
 * Tracking connections is not generally necessary and is only used to explicitly all incoming sockets to
 * Express, which is not strictly necessary to do before exit.  As this functionality was not necessary
 * for graceful shutdown handling this deprecated function has been left as a no-op to prevent applications
 * that accidentally called it from having problems upon upgrade.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function init(server: http.Server): void {
  // Do nothing - use trackConnections instead which requires the Express app to be passed as well
}

/**
 * Track open connections to forcibly close sockets if and when the hard exit handler runs
 * @param server HTTP server.
 *
 */
export function trackConnections(server: http.Server, app: Express): void {
  if (server === undefined || !(server instanceof http.Server)) {
    // eslint-disable-next-line no-console
    console.error(
      'express-graceful-exit - trackConnections() error - `server` is not an `http.Server` - connection tracking will not work!',
    );
    return;
  }
  if (app === undefined) {
    // eslint-disable-next-line no-console
    console.error(
      'express-graceful-exit - trackConnections() error - `app` undefined - connection tracking will not work!',
    );
    return;
  }

  const state = app.get('gracefulExit_state') as Middleware;

  // This is bad... our state object was not available
  if (state === undefined) {
    // Can't use logger because we can't get the middleware object that has a ref to it
    console.error('express-graceful-exit - trackConnections state object was not available ');
    return;
  }

  // Indicate that connection tracking has started
  state.trackingSocketsStarted();

  // Keep track of each socket as it connects to Express
  server.on('connection', (socket: Socket) => {
    state.trackSocketOpen(socket);

    // Remove each socket as it disconnects
    socket.on('close', () => {
      state.trackSocketClose(socket);
    });
  });
}

/**
 * Initiate the graceful exit process (typically called in response to SIGTERM, SIGHUP, etc.)
 *
 * @param app Express application
 * @param server http.Server (returned by app.listen()) used to track connections
 * @param _options Configuration
 */
export function gracefulExitHandler(
  app: Express,
  server: http.Server,
  options: Configuration = {},
): void {
  const state = app.get('gracefulExit_state') as Middleware;

  // This is bad... our state object was not available
  if (state === undefined) {
    // Can't use logger because we can't get the middleware object that has a ref to it
    console.error(
      'express-graceful-exit - gracefulExitHandler state object was not available - calling server.close() immediately',
    );
    server.close();
    return;
  }

  if (state.gracefulExitHandlerCallTime !== 0) {
    console.error('express-graceful-exit - gracefulExitHandler called more than once - ignoring');
    return;
  }

  void state.initiateGracefulExit(server, options);
}

/**
 * Express middleware that sets the `connection: close` response header when in `graceful_exit` mode
 *
 * @param app Express application
 * @returns
 */
export function middleware(app: Express): RequestHandler {
  // Create the middleware state class and attach it to the Express app
  // Note: this is necessary because Express can be started and stopped multiple times in one
  // process lifetime (e.g. during tests in particular)
  app.set('gracefulExit_state', new Middleware());

  return (req: Request, res: Response, next: NextFunction) => {
    const state = app.get('gracefulExit_state') as Middleware;

    // This is bad... our state object was not available
    if (state === undefined) {
      // Can't use logger because we can't get the middleware object that has a ref to it
      console.error('express-graceful-exit - middleware state object was not available');
      return next();
    }

    if (!state.draining) {
      return next();
    }

    return state.handleFinalRequests(req, res, next);
  };
}
