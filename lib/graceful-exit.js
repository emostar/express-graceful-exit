
var _ = require('underscore')

exports.middleware = function(app) {
  // This flag is used to tell the middleware we create that the server wants
  // to stop, so we do not allow anymore connections. This is done for all new
  // connections for us by Node, but we need to handle the connections that are
  // using the Keep-Alive header to stay on.
  app.set('graceful_exit', false)

  return function(req, res, next) {
    // We override res.end so that we can differentiate between connections
    // that are really in the middle of execution and the ones that are just
    // being kept alive.
    var rEnd = res.end
    res.end = function(chunk, encoding) {
      // And this connection is done
      req.connection.graceful = {processing: false}

      // Go back to the real res.end
      res.end = rEnd
      res.end(chunk, encoding)
    }

    // Sorry Keep-Alive connections, but we need to part ways
    if (app.settings.graceful_exit === true) {
      res.setHeader('Connection', 'close')
      res.send(502, 'Server is exiting')
      return
    }

    // And we are in the middle of something real
    req.connection.graceful = {processing: true}

    next()
  }
}

exports.gracefulExitHandler = function(app, server, _options) {
  // Get the options set up
  if (!_options) _options = {}
  var options = _.defaults(_options, {
      log               : false
    , logger            : console.log
    , suicideTimeout    : 3*60*1000 // 3m in ms
  })

  function logger(str) {
    if (options.log)
      options.logger(str)
  }

  logger('Closing down the server')

  // Let everything know that we wish to exit gracefully
  app.set('graceful_exit', true)

  // Time to stop accepting new connections
  server.close(function() {
    // Everything was closed successfully, mission accomplished!
    logger('All connections done, stopping process')
    process.exit(0)
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
    logger('Exiting process with some open connections left')
    process.exit(1)
  }, options.suicideTimeout)
}
