
var _ = require('lodash')
var sockets = []

/**
 * Keep track of open connections so we can forcibly close sockets when the suicide timeout elapses
 * @param server HTTP server
 */
exports.init = function (server) {
  server.on('connection', function (socket) {
    sockets.push(socket)

    socket.on('close', function () {
      sockets.splice(sockets.indexOf(socket), 1)
    })
  })
}

exports.gracefulExitHandler = function(app, server, _options) {
  // Get the options set up
  if (!_options) _options = {}
  var options = _.defaults(_options, {
      log               : false
    , logger            : console.log
    , suicideTimeout    : 2*60*1000 + 10*1000 // 2m10s (nodejs default is 2m)
    , exitProcess       : true
    , force             : false
  })

  function logger(str) {
    if (options.log)
      options.logger(str)
  }

  function exit(code) {
    if (options.exitProcess){
      process.exit(code)
    } else if (options.callback) {
      if (_.isFunction(options.callback)) {
        options.callback(code)
      } else {
        logger("Registered callback is not a function")
      }
    }
  }

  if (options.callback && options.exitProcess) {
    logger("Registering a callback and exiting is not advised. " +
           "Callback should be registered when process shutdwon is handled by the caller");
  }

  logger('Closing down the server')

  // Let everything know that we wish to exit gracefully
  app.set('graceful_exit', true)

  // Time to stop accepting new connections
  server.close(function() {
    // Everything was closed successfully, mission accomplished!
    logger('All connections done, stopping process')
    exit(0)
  })

  // Disconnect all the socket.io clients
  if (options.socketio) {
    options.socketio.sockets.clients().forEach(function(socket) {
      logger('Killing socketio socket')
      socket.disconnect()
    })
  }

  // If after an acceptable time limit is reached and we still have some
  // connections lingering around for some reason, just die... we tried to
  // be graceful, but failed.
  setTimeout(function() {
    if (options.force) {
      logger('Destorying ' + sockets.length + ' open sockets')
      sockets.forEach(function (socket) {
        socket.destroy()
      })
    } else {
      logger('Exiting process with some open connections left')
    }
    exit(1);
  }, options.suicideTimeout)
}

exports.middleware = function(app) {
  // This flag is used to tell the middleware we create that the server wants
  // to stop, so we do not allow anymore connections. This is done for all new
  // connections for us by Node, but we need to handle the connections that are
  // using the Keep-Alive header to stay on.
  app.set('graceful_exit', false)

  return function(req, res, next) {
    // Sorry Keep-Alive connections, but we need to part ways
    if (app.settings.graceful_exit === true) {
      req.connection.setTimeout(1)
    }

    next()
  }
}
