# express-graceful-exit

A component in having zero downtime deploys for Node.js with [Express](http://expressjs.com/). It was developed for Express 3.X, so it may need work to be compatible with Express 2.X

This module was originally developed for [Frafty](https://www.frafty.com/), a Daily Fantasy Sports site.

## Installation

```` bash
$ cd /path/to/your/project
$ npm install express-graceful-exit
````

## Compatibility

v0.X.X versions are backwards API compatible, with the caveate that process exit is called in a `setTimeout` block from v0.2.0 forward, so the timing is slightly different between v0.1.0 to v0.2.x+.

## Usage

The following two components must both be used to enable fully graceful exits.

### middleware

This middleware should be the very first middleware that gets setup with your Express app.

```` javascript
var express = require('express');
var app = express();
var gracefulExit = require('express-graceful-exit');

app.use(gracefulExit.middleware(app));
````

### gracefulExitHandler

This function tells express to accept no new requests and gracefully closes the http server. It can be attached to a signal, or used as a normal function call if another tool is used (such as [naught](https://github.com/indabamusic/naught)).

```` javascript
// Example for naught
process.on('message', function(message) {
  if (message === 'shutdown') {
    gracefulExit.gracefulExitHandler(app, server, {
        socketio: app.settings.socketio
    });
  }
});
````

## Options

### Middleware

There are no options available currently.

### Exit Handler

The following options are available:

 Option              |  Description                                     |  Default
 :------------------ |  :---------------------------------------------- |  :-------
 __log__             |  Print status messages and errors to the logger  |  false
 __logger__          |  Function that accepts a string to output a log message  |  console.log
 __callback__        |  Optional function that is called with the exit status code once express has shutdown, gracefully or not <br> Use in conjunction with  `exitProcess: false` when the caller handles process shutdown  |  no-op
 __exitProcess__     |  If true, the module calls `process.exit()` when express has shutdown, gracefully or not  |  true
 __exitDelay__       |  Wait timer duration in the final internal callback (triggered either by gracefulExitHandler or the suicideTimeout) if `exitProcess: true`  |  10ms
 __suicideTimeout__  |  How long to wait before giving up on graceful  shutdown, then returns exit code of 1  |  2m 10s (130s)
 __socketio__        |  An instance of `socket.io`, used to close all  open connections after timeout  |  none
 __force__           |  Instructs the module to forcibly close sockets once the suicide timeout elapses. <br> For this option to work you must call `gracefulExit.init(server)` when initializing the HTTP server  |  false

## Details

To gracefully exit this module will do the following things:

1. Close the http server so no new connections are accepted
2. Mark that the server will gracefully exit, so if a connection that is using the Keep-Alive header is still active, it will be told to close the connection  
The HTTP status code of 502 is returned, so nginx, ELB, etc will try again with a working server
3. If a socket.io instance is passed in the options, it enumerates all connected clients and disconnects them  
The client should have code to reconnect on disconnect
4. Server fully disconnects or the hard exit timer runs
    1. Once all connected clients are disconnected, the exit handler returns `0`
    2. OR If there are any remaining connections after `suicideTimeout` ms, the handler returns `1`
5. In either case, if exitProcess is set to true the exit handler waits exitDelay ms and calls `process.exit`

## Zero Downtime Deploys

This module does not give you zero downtime deploys on its own. It enables the http server to exit gracefully, which when used with a module like naught can provide zero downtime deploys.

#### Author: [Jon Keating](http://twitter.com/emostar)
#### Maintainer: [Ivo Havener](https://github.com/ivolucien)

