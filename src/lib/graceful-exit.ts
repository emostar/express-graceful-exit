import { Socket } from 'net';
import http from 'http';
import { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { Configuration } from './configuration';
import { Middleware } from './middleware';

export const APP_MIDDLEWARE_NAME = 'gracefulExitMiddleware';

export function notAnObject(target) {
  return !(target instanceof Object); // works correctly for null and undefined
}

/**
  * init() is replaced by trackConnections()
  * Unless you have specific need to track incoming sockets, callingtrackConnnections()` is unnecessary
  * @deprecated 2022-11-03
  */
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
export function init(server: http.Server): void {
  // Do nothing - use trackConnections instead which requires the Express app to be passed as well
}

/**
 * Track open connections to support forcibly closing sockets upon hard exit
 * @param server HTTP server.
 *
 */
export function trackConnections(server: http.Server, app: Express): void {
  // keeping checks generic to allow test mocking
  // instanceof functional for empty param
  if (notAnObject(app)) {
    // logger in unreachable middleware object, using console
    // eslint-disable-next-line no-console
    console.error(`Passed express "app" parameter of "${app}", connection tracking impossible`);
    return;
  }

  const middleware = app.get(APP_MIDDLEWARE_NAME) as Middleware;

  if (notAnObject(middleware)) {
    console.error(`Failed to get middleware, "${middleware}" is not an object`);
    return;
  }

  if (notAnObject(server)) {
    // eslint-disable-next-line no-console
    middleware.logger(`Passed http "server" parameter of "${server}", connection tracking impossible`);
    return;
  }

  // Indicate that connection tracking has started
  middleware.trackingSocketsStarted();

  // Keep track of each socket as it connects to Express
  server.on('connection', (socket: Socket) => {
    middleware.trackSocketOpen(socket);

    // Remove each socket as it disconnects
    socket.on('close', () => {
      middleware.trackSocketClose(socket);
    });
  });
}

/**
 * Initiate the graceful exit process (typically called in response to SIGTERM, SIGHUP, etc.)
 *
 * @param app Express application object
 * @param server http.Server (returned by app.listen()) used to track connections
 * @param _options Configuration
 */
 export function gracefulExitHandler(
  app: Express,
  server: http.Server,
  options: Configuration = {},
): void {
  const middleware = app?.get(APP_MIDDLEWARE_NAME) as Middleware;

  if (notAnObject(middleware)) {
    // logger in missing middleware object, using console
    console.error(`Failed to get middleware, "${middleware}" is not an object`);
    return;
  }

  if (middleware.gracefulExitHandlerCallTime !== 0) {
    console.warn('gracefulExitHandler called more than once, ignoring');
    return;
  }

  void middleware.initiateGracefulExit(server, options);
}

/**
 * Express middleware that supports graceful exit, from close headers to request refusal
 *
 * @param app Express application
 * @returns
 */
export function middleware(app: Express): RequestHandler {
  // Create and wrap the middleware and store it in the Express app
  // Note: this supports Express starting and stopping multiple times in one process (tests)
  app.set(APP_MIDDLEWARE_NAME, new Middleware());

  return (req: Request, res: Response, next: NextFunction) => {
    const gracefulMiddleware = app.get(APP_MIDDLEWARE_NAME) as Middleware;

    if (notAnObject(gracefulMiddleware)) {
      // logger in unreachable middleware object, using console
      console.error(`Failed to get middleware, got "${gracefulMiddleware}" instead`);
      return next();
    }

    if (!gracefulMiddleware.draining) {
      return next();
    }

    return gracefulMiddleware.handleFinalRequests(req, res, next);
  };
}