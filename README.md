# express-graceful-exit

Gracefully decline new requests while shutting down your application. A component that helps support zero downtime deploys for Node.js with [Express](http://expressjs.com/).

The project was originally developed for Express v3.X, but is used in production with Express v4.X. Please write up an issue or submit a PR if you find bugs using express-graceful-exit with Express v4.X and higher.

## Installation

```` bash
$ cd /path/to/your/project
$ npm install express-graceful-exit
````

## Compatibility

v0.X.X versions are backwards API compatible, with these minor behavior changes:
1. Process exit is called in a `setTimeout` block from v0.2.0 forward, so the timing is slightly different between v0.1.0 to v0.2.x+.
2. After exit was triggered, incoming requests were mismanaged prior to v0.5.0. <br> As of v0.5.0 incoming requests are dropped cleanly by default, with new options such as responding with a custom error and/or performing one last request per connection.

## Usage

The following two components must both be used to enable clean server shutdown, where incoming requests are gracefully declined.

There are multiple exit options for how in-flight requests are handled, ranging from forced exist after a specified deadline to waiting indefinitely for processing to complete.

### middleware

This middleware should be the very first middleware that gets setup with your Express app.

```` javascript
var express = require('express');
var app = express();
var gracefulExit = require('express-graceful-exit');

var server = app.listen(port)

gracefulExit.init(server) // use init() if configured to exit the process after timeout
app.use(gracefulExit.middleware(app));
````

### gracefulExitHandler

This function tells express to accept no new requests and gracefully closes the http server. It can be attached to a signal, or used as a normal function call if another tool is used (such as [naught](https://github.com/indabamusic/naught)).

```` javascript
// Example for naught
process.on('message', function(message) {
  if (message === 'shutdown') {
    gracefulExit.gracefulExitHandler(app, server, {
        <see options below>
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
 __performLastRequest__ |  Process the first request received per connection after exit starts, and include a connection close header for callers and load balancers. <br> `false` is the existing behavior, deprecated as of v0.5.0 |  false
 __errorDuringExit__ |  Respond to incoming requests with an error instead of silently dropping them. <br> `false` is the existing behavior, deprecated as of v0.5.0  |  false
 __getRejectionError__  |  Function returning rejection error for incoming requests during graceful exit | `function () { return new Error('Server unavailable, no new requests accepted during shutdown') }`
 __exitProcess__      |  If true, the module calls `process.exit()` when express has shutdown, gracefully or not  |  true
 __exitDelay__       |  Wait timer duration in the final internal callback (triggered either by gracefulExitHandler or the hard exit handler) if `exitProcess: true`  |  10ms
  __suicideTimeout__ |  How long to wait before giving up on graceful shutdown, then returns exit code of 1  |  2m 10s (130s)
 __socketio__        |  An instance of `socket.io`, used to close all open connections after timeout  |  none
 __force__           |  Instructs the module to forcibly close sockets once the suicide timeout elapses. <br> For this option to work you must call `gracefulExit.init(server)` when initializing the HTTP server  |  false

## Details

To gracefully exit this module does the following things:

1. Closes the http server so no new connections are accepted
2. Sets connection close header for Keep-Alive connections, if configured for responses</br> The HTTP status code of 502 is returned, so nginx, ELB, etc will try with an active server</br> If `errorDuringExit` and/or `performLastRequest` are set to true, a response is sent with a `Connection: close` header
3. If a socket.io instance is passed in the options, all connected clients are immediately disconnected (socket.io v0.X through v1.4.x support)</br> The client should have code to reconnect on disconnect
4. Once the server fully disconnects or the hard exit timer runs
    1. If all in-flight requests have resolved and/or disconnected, the exit handler returns `0`
    2. OR if any connections remain after `suicideTimeout` ms, the handler returns `1`
5. In either case, if exitProcess is set to true the hard exit handler waits exitDelay ms and calls `process.exit(x)`, this allows the logger time to flush and the app's callback to complete, if any

## Zero Downtime Deploys

This module does not give you zero downtime deploys on its own. It enables the http server to exit gracefully, which when used with a module like naught can provide zero downtime deploys.

#### Author: [Jon Keating](http://twitter.com/emostar)
This module was originally developed for Frafty (formerly www.frafty.com), a Daily Fantasy Sports site.
#### Maintainer: [Ivo Havener](https://github.com/ivolucien)

