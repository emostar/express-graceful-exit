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
var express = require('express')
  , app = express()
  , gracefulExit = require('express-graceful-exit')

app.use(gracefulExit.middleware(app))
````

### Process Handler

The process handler will catch a signal that starts the graceful exit. It should be called fairly early in the configuration of your Express app.

```` javascript
var server = app.listen(app.set('port'))

gracefulExit.setProcessHandler(app, server, {
  socketio : app.settings.socketio
})
````

## Options

### Middleware

There are no options available currently.

### Process Handler

The following options are available:

* __exitSignal:__ The signal that starts the graceful exit (default 'SIGUSR2').
* __log:__ Shows some messages about what is going on (default false).
* __logger:__ Function that accepts a string to output a log message (default console.log).
* __keepAliveInterval:__ The interval in ms that tries to close a Keep-Alive socket (default 100).
* __suicideTimeout:__ The timeout to forcefully exit the process with a return code of 1 (default 30000).
* __socketio:__ An instance of socket.io, that will close all open socket.io connections (default none)

## Details

To gracefully exit this module will do the following things:

1. Close the server so no new connections get accepted
2. Mark that the server will gracefully exit, so if a connection that is using the Keep-Alive header is still active, it will be told to close the connection. The HTTP status code of 502 is returned, so nginx, ELB, etc will try again with a working server.
3. If a socket.io instance is passed in the options, it enumerates all connected clients and disconnects them. The client should have code to reconnect on disconnect.
4. All open connections are enumerated, and if they are idle, they will be closed.
5. Once all connected clients are disconnected, the server exits with an error code of 0.
6. If there are still some remaining connections after the `suicideTimeout`, the server ungracefully exits with an error code of 1.

### Tradeoffs

In order to keep a list of Keep-Alive connected clients, this module will keep track of all connected sockets in an object.

## Getting zero downtime deploys

This module does not give you zero downtime deploys automatically, but provides a server that is capable of exiting gracefully, which can then be used by nginx or ELB to provide zero downtime deploys. You must have more than one process running and all processes must not be gracefully exited at the same time, if you wish to have a zero downtime deploy process in place.

A process manager will need to be used that can restart the server. I have used [forever](https://github.com/nodejitsu/forever) to get a zero downtime deploy, but currently you must use a non-released version of forever. I forked the code and put it up on BitBucket at https://bitbucket.org/frafty/forever Once the main branch of forever includes the proper patches, this fork will not be necessary anymore.

Once you have the version of forever that supports the --killSignal option, you will need to start your server like this:

```` bash
$ forever --killSignal SIGUSR2 server.js
````

And then when you are deploying new code, to restart the server you will need to do this command:
```` bash
$ forever restartall
````

Forever will then wait for your server to gracefuly exit, and then restart it.

#### Author: [Jon Keating](http://twitter.com/emostar)

