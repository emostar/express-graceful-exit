"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var middleware_1 = require("./middleware");
exports.APP_MIDDLEWARE_NAME = 'gracefulExitMiddleware';
function notAnObject(target) {
    return !(target instanceof Object); // works correctly for null and undefined
}
exports.notAnObject = notAnObject;
/**
  * init() is replaced by trackConnections()
  * Unless you have specific need to track incoming sockets, callingtrackConnnections()` is unnecessary
  * @deprecated 2022-11-03
  */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function init(server) {
    // Do nothing - use trackConnections instead which requires the Express app to be passed as well
}
exports.init = init;
/**
 * Track open connections to support forcibly closing sockets upon hard exit
 * @param server HTTP server.
 *
 */
function trackConnections(server, app) {
    // keeping checks generic to allow test mocking
    // instanceof functional for empty param
    if (notAnObject(app)) {
        // logger in unreachable middleware object, using console
        // eslint-disable-next-line no-console
        console.error("Passed express \"app\" parameter of \"" + app + "\", connection tracking impossible");
        return;
    }
    var middleware = app.get(exports.APP_MIDDLEWARE_NAME);
    if (notAnObject(middleware)) {
        console.error("Failed to get middleware, \"" + middleware + "\" is not an object");
        return;
    }
    if (notAnObject(server)) {
        // eslint-disable-next-line no-console
        middleware.logger("Passed http \"server\" parameter of \"" + server + "\", connection tracking impossible");
        return;
    }
    // Indicate that connection tracking has started
    middleware.trackingSocketsStarted();
    // Keep track of each socket as it connects to Express
    server.on('connection', function (socket) {
        middleware.trackSocketOpen(socket);
        // Remove each socket as it disconnects
        socket.on('close', function () {
            middleware.trackSocketClose(socket);
        });
    });
}
exports.trackConnections = trackConnections;
/**
 * Initiate the graceful exit process (typically called in response to SIGTERM, SIGHUP, etc.)
 *
 * @param app Express application object
 * @param server http.Server (returned by app.listen()) used to track connections
 * @param _options Configuration
 */
function gracefulExitHandler(app, server, options) {
    if (options === void 0) { options = {}; }
    var middleware = app === null || app === void 0 ? void 0 : app.get(exports.APP_MIDDLEWARE_NAME);
    if (notAnObject(middleware)) {
        // logger in missing middleware object, using console
        console.error("Failed to get middleware, \"" + middleware + "\" is not an object");
        return;
    }
    if (middleware.gracefulExitHandlerCallTime !== 0) {
        console.warn('gracefulExitHandler called more than once, ignoring');
        return;
    }
    void middleware.initiateGracefulExit(server, options);
}
exports.gracefulExitHandler = gracefulExitHandler;
/**
 * Express middleware that supports graceful exit, from close headers to request refusal
 *
 * @param app Express application
 * @returns
 */
function middleware(app) {
    // Create and wrap the middleware and store it in the Express app
    // Note: this supports Express starting and stopping multiple times in one process (tests)
    app.set(exports.APP_MIDDLEWARE_NAME, new middleware_1.Middleware());
    return function (req, res, next) {
        var gracefulMiddleware = app.get(exports.APP_MIDDLEWARE_NAME);
        if (notAnObject(gracefulMiddleware)) {
            // logger in unreachable middleware object, using console
            console.error("Failed to get middleware, got \"" + gracefulMiddleware + "\" instead");
            return next();
        }
        if (!gracefulMiddleware.draining) {
            return next();
        }
        return gracefulMiddleware.handleFinalRequests(req, res, next);
    };
}
exports.middleware = middleware;
