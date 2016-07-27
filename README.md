# express-graceful-exit

A component in having zero downtime deploys for Node.js with [Express](http://expressjs.com/). It was developed for Express 3.X, so it may need work to be compatible with Express 2.X

This module was developed for [Frafty](https://www.frafty.com/), a Daily Fantasy Sports site.

## Installation

```` bash
$ cd /path/to/your/project
$ npm install express-graceful-exit
````

## Usage

The following two components must be setup for this to work as planned.

### Middleware

This middleware should be the very first middleware that gets setup with your Express app.

```` javascript
var express = require('express');
var app = express();
var gracefulExit = require('express-graceful-exit');

app.use(gracefulExit.middleware(app));
````

### Graceful Exit Handler

This function will cleanup the server and get it ready for shutting down. It can be attached to a signal, or used as a normal function call if another tool is used (such as [naught](https://github.com/indabamusic/naught)).

```` javascript
// Example for naught
process.on('message', function(message) {
  if (message === 'shutdown') {
    gracefulExit.gracefulExitHandler(app, server, {
        socketio: app.settings.socketio
    })
  }
})
````

## Options

### Middleware

There are no options available currently.

### Process Handler

The following options are available:

* __log:__ Print status messages and errors to the logger (default false).
* __logger:__ Function that accepts a string to output a log message (default console.log).
* __suicideTimeout:__ How long to wait before giving up on graceful shutdown, then returns exit code of 1 (default 2m 10s).
* __socketio:__ An instance of `socket.io`, used to close all open connections after timeout (default none)
* __exitProcess:__ If true, the module calls `process.exit()` when express has shutdown, gracefully or not (default true).
* __callback:__ Optional function that is called with the exit status code once express has shutdown, gracefully or not - use in conjunction with exitProcess=false, when the caller handles process shutdown (default none)
* __force:__ Instructs the module to forcibly close sockets once the suicide timeout elapses. Requires that `gracefulExit.init(server)` be called when initializing the HTTP server (default: false)

## Details

To gracefully exit this module will do the following things:

1. Close the http server so no new connections are accepted
2. Mark that the server will gracefully exit, so if a connection that is using the Keep-Alive header is still active, it will be told to close the connection. The HTTP status code of 502 is returned, so nginx, ELB, etc will try again with a working server
3. If a socket.io instance is passed in the options, it enumerates all connected clients and disconnects them. The client should have code to reconnect on disconnect
4. Once all connected clients are disconnected, the server exits with an error code of 0
5. If there are still some remaining connections after the `suicideTimeout`, it stops waiting and returns exit code of 1

## Getting zero downtime deploys

This module does not give you zero downtime deploys automatically, but provides a server that is capable of exiting gracefully, which can then be used by a module like naught to provide zero downtime deploys.

#### Author: [Jon Keating](http://twitter.com/emostar)
#### Maintainer: [Ivo Havener](https://github.com/ivolucien)
