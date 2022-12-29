# express-graceful-exit

tl;dr - Gracefully handle final requests while your Express app shuts down.

Graceful shutdown helps your application manage its own exit process, to complete in-flight requests and avoid error responses, dropped requests and/or error alarms.

## Installation

```` bash
$ cd /path/to/your/project
$ npm install express-graceful-exit
````

## Compatibility

v1.0.0 is mostly backwards compatible with v0.x.x
 1. typescript rewrite

**Breaking Changes**
 1. Apps that pass in `force: true` and call `init()` must change `init` to `trackConnections` and pass in both `server` and `app`
 1. `init()` renamed to `trackConnections()` and requires passing both the Express `server` and `app` - Note that `trackConnections` should ONLY be called if `destroySocketsOnHardExit` is `true` as the list of Express sockets is not necessary in any other case - Calling `init` will log an error advising to call `trackConnections` instead and continue without error.
 1. `suicideTimeout` option deprecated, replaced by `hardExitTimeout`. Either option works for now, but a future version (2.0?) will drop the `suicideTimeout` property.
 1. `force` option deprecated, replaced by `destroySocketsOnHardExit`. Either option works for now, but a future major version will drop the `force` property.

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

This function tells express to accept no new requests and gracefully closes the http server. It can be called when the  receiving a signal like SIGTERM, or used as a normal function call if another tool is used to initiate shutdown (such as [naught](https://github.com/indabamusic/naught)).

``` javascript
// Example signal handler
  process.on('SIGTERM', function () {
    log.warn('SIGTERM received, shutting down')
    gracefulExit.gracefulExitHandler(app, server, {
        <see options below>
    });
  })
```
```
// Example for naught
process.on('message', function(message) {
  if (message === 'shutdown') {
    gracefulExit.gracefulExitHandler(app, server, {
        <see options below>
    });
  }
});
```

## Options

### Middleware

There are no options available currently.

### Exit Handler

The following options are available:

 Option              |  Description                                     |  Default
 :------------------ |  :---------------------------------------------- |  :-------
 __log__             |  Print status messages and errors to the logger  |  `true` if `logger' option passed in
 __logger__          |  Function that accepts a string to output a log message  |  `console.log`
 __callback__        |  Optional function that is called with the exit status code once express has shutdown, gracefully or not <br> Use in conjunction with  `exitProcess: false` when the caller handles process shutdown  |  no-op
 __performLastRequest__ |  Process the first request received per connection after exit starts, and include a connection close header in the response for the caller and/or load balancer. <br> The current default is `true`, was `false` prior to v1.0.0 |  `true` (**true is recommended**)
 __errorDuringExit__ |  When requests are refused during graceful exit, respond with an error instead of silently dropping them. <br> The current default is `true`, was `false` prior to v1.0.0 | `true` (**true is recommended**)
 __getRejectionError__  |  Function returning rejection error for incoming requests during graceful exit | `function () { return new Error('Server unavailable, no new requests accepted during shutdown') }` | `null`
 __exitProcess__      |  If true, the module calls `process.exit()` when express has shutdown, gracefully or not  |  `true`
 __exitDelay__       |  Wait timer duration in the final internal callback (triggered either by gracefulExitHandler or the hard exit handler) if `exitProcess: true`  |  10ms
 __serverCloseMinDelay__ | Min duration after `gracefulExitHandler` is called before `server.close()` is called | undefined
 __serverCloseMaxDelay__ | Max duration after `gracefulExitHandler` is called before `server.close()` is called | 60000 ms (60 seconds)
  __hardExitTimeout__ (or deprecated __suicideTimeout__) |  How long to wait before giving up on graceful shutdown, and calling process.exit(1)  |  2m 10s (130s)
 __socketio__        |  An instance of `socket.io`, used to close all open connections after timeout  |  none
 __destroySocketsOnHardExit__ (or deprecated __force__)  |  Instructs the module to forcibly close sockets once hardExitTimeout elapses. <br> For this option to work you must call `gracefulExit.init(server, app)` when initializing the HTTP server  |  false

## Details

To gracefully exit this module does the following things, all options are active for this example:

1. Within the serverCloseMin/MaxDelay window, closes the http server so no new connections are accepted
1. Sets connection close header for Keep-Alive connections, if configured for responses
   1. If `performLastRequest` is true, the request is run and a response is sent with a `Connection: close` header
   1. If `errorDuringExit` is true, HTTP status code 502 is returned by default, so nginx, ELB, etc will resend to an active server
   1. If both `performLastRequest` and `errorDuringExit` are set to false then the request is not run and the HTTP status code will be 200 - This is not recommended
1. If a socket.io instance is passed in the options, all connected clients are immediately disconnected (socket.io v0.X through v1.4.x support)</br> The client should have code to reconnect on disconnect
1. Once the server fully disconnects or the hard exit timer runs
    1. If all in-flight requests have resolved and/or disconnected, the exit handler returns `0`
    1. OR if any connections remain after `suicideTimeout` ms, the handler returns `1`
1. In either case, if exitProcess is set to true the hard exit handler waits exitDelay ms and calls `process.exit(x)`, this allows the logger time to flush and the app's callback to complete, if any

## Zero Downtime Deploys

This module does not give you zero downtime deploys on its own. It enables the http server to exit gracefully, which when used with a module like naught can provide zero downtime deploys.

#### Author: [Jon Keating](http://twitter.com/emostar)
This module was originally developed for Frafty (formerly www.frafty.com), a Daily Fantasy Sports site.
#### Maintainer: [Ivo Havener](https://github.com/ivolucien)
#### Contributor: [Harold Hunt](https://github.com/huntharo)
