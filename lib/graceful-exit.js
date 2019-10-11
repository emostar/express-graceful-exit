
var _ = require('underscore');
var inspect = require('util').inspect

var sockets = [];
var options = {};
var hardExitTimer;
var connectionsClosed = false;

var defaultOptions = {
  log               : false,
  logger            : console.log,
  suicideTimeout    : 2*60*1000 + 10*1000,  // 2m10s (nodejs default is 2m)
  exitProcess       : true,
  exitDelay         : 10,    // wait in ms before process.exit, if exitProcess true
  respondDuringExit : false,
  unavailableError  : function (err) { return err; },
  force             : false
};

function logger (str) {
  if (options.log) {
    options.logger(str);
  }
}

/**
 * Track open connections to forcibly close sockets if and when the hard exit handler runs
 * @param server HTTP server
 */
exports.init = function init (server) {
  server.on('connection', function (socket) {
    sockets.push(socket);

    socket.on('close', function () {
      sockets.splice(sockets.indexOf(socket), 1);
    });
  });
};

exports.disconnectSocketIOClients = function disconnectSocketIOClients () {
  var sockets = options.socketio.sockets;
  var connectedSockets;
  if (typeof sockets.sockets === 'object' && !Array.isArray(sockets.sockets)) {
    // socket.io 1.4+
    connectedSockets = _.values(sockets.sockets);
  }
  else if (sockets.sockets && sockets.sockets.length) {
    // socket.io 1.0-1.3
    connectedSockets = sockets.sockets;
  }
  else if (typeof sockets.clients === 'function') {
    // socket.io 0.x
    connectedSockets = sockets.clients();
  }
  if (typeof options.socketio.close === 'function') {
    options.socketio.close();
  }
  if (connectedSockets && connectedSockets.length) {
    logger('Killing ' + connectedSockets.length + ' socket.io sockets');
    connectedSockets.forEach(function(socket) {
      socket.disconnect();
    });
  }
};

function exit (code) {
  if (hardExitTimer === null) {
    return;  // server.close has finished, don't callback/exit twice
  }
  if (_.isFunction(options.callback)) {
    options.callback(code);
  }
  if (options.exitProcess) {
    logger("Exiting process with code " + code);
    // leave a bit of time to write logs, callback to complete, etc
    setTimeout(function() {
      process.exit(code);
    }, options.exitDelay);
  }
}

exports.hardExitHandler = function hardExitHandler () {
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
  hardExitTimer = null;
};

exports.gracefulExitHandler = function gracefulExitHandler (app, server, _options) {
  // Get the options set up
  if (!_options) {
    _options = {};
  }
  options = _.defaults(_options, defaultOptions);
  if (options.callback) {
    if (!_.isFunction(options.callback)) {
      logger("Ignoring callback option that is not a function");
    }
    else if (options.exitProcess) {
      logger("Callback has " + options.exitDelay + "ms to complete before hard exit");
    }
  }
  logger('Closing down the http server');

  // Let everything know that we wish to exit gracefully
  app.set('graceful_exit', true);

  // Time to stop accepting new connections
  server.close(function serverClosedCallback () {
    // Everything was closed successfully, mission accomplished!
    connectionsClosed = true;

    logger('No longer accepting connections');
    exit(0);

    clearTimeout(hardExitTimer);  // must be cleared after calling exit()
    hardExitTimer = null;
  });

  // Disconnect all the socket.io clients
  if (options.socketio) {
    exports.disconnectSocketIOClients();
  }

  // If any connections linger past the suicide timeout, exit the process.
  // When this fires we've run out of time to exit gracefully.
  hardExitTimer = setTimeout(exports.hardExitHandler, options.suicideTimeout);
};

exports.middleware = function middleware (app) {
  // This flag is used to signal the below middleware when the server wants to stop.
  // New connections are handled for us by Node, but existing connections using the
  // Keep-Alive header require this workaround to close.
  app.set('graceful_exit', false);

  return function checkIfExitingGracefully (req, res, next) {
    if (app.settings.graceful_exit === true) {
      const headers = inspect(req.headers)
      if (options.respondDuringExit) {
        logger('Server unavailable, incoming request rejected with error: ' + headers || '?');
        // Signal the caller that the connection is closing, if before suicideTimeout
        // 2019-09-10 - HH - Fix request processing after connection closes, see issue 14
        res.set('Connection', 'close');
        return next(
          options.unavailableError() ||
          defaultOptions.unavailableError(
              new Error('Server unavailable, no new requests accepted during shutdown')
            )
        );
      } else {
        logger('Server unavailable, incoming request dropped silently: ' + headers || '?');
        res.end(); // silently drop request without response (existing deprecated behavior)
        return;
      }
    }

    next();
  };
};
