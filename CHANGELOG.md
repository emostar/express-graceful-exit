0.4.0 / 2017-03-19
==================

  * Support disconnect for more socket.io versions

0.3.2 / 2016-08/05
==================

  * Released version to npm
  * This version entry, npm keeping me honest

0.3.1 / 2016-08/05
==================

  * Doc format fixes

0.3.0 / 2016-08/05
==================

  * Released version to npm
  * Configurable delay for timer that calls process exit
  * Hard exit function now obeys exitProcess option
  * Doc updates, options in table format

0.2.1 / 2016-07-27
==================

  * Released version to npm
  * Updated package metadata, version string
  * Code style overhaul, many semicolons

0.2.0 / 2016-07-26
==================
Thanks to shaharke for the majority of these changes.

  * Delay process exit to allow any streams to flush, etc.
  * Option to force close sockets on timeout
  * Minor doc and logging improvements

  Issue #1 feature request and fixes:
  * Exit handler callback when done or on timeout
  * Option for exit handler to not exit process itself
  * Clear hard exit timeout on successful server close
  * Avoid duplicate callback invocation

0.1.0 / 2013-03-28
==================

  * Released version to npm
  * Don't keep track of Keep-Alive connections
  * Switch to not catching the exit message on our own

0.0.2 / 2013-03-26
==================

  * Typo fix in README

0.0.1 / 2013-03-26
==================

  * Initial Release
