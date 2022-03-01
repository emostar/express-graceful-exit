# 1.0.0 / 2022-02-25

- TypeScript rewrite
- Document all exported options and functions with jsdoc
- Add `eslint` and `prettier`
- Add `jest` and tests with `> 80%` statements, functions, and lines coverage
- Add GitHub Actions for continuous integration builds
- Validate parameters and log errors (but continue) when parameters are incompatible
- Store all state attached to one Express `app` instance to fix issues with in-process re-init of Express (e.g. during tests)
- `init` replaced with `trackConnections`
  - `trackConnections` requires the Express `app` to be passed as well as the `server` so that tracking can be isolated to a single instance instead of via global variables
  - Fixes `O(n^2)` performance in `trackConnections` due to storing connection references in an `Array`
  - Calls to `init` will log an error and do nothing as this method incurred performance penalty but was only needed when `force` was set to `true` (in other words `init` was likely being called by many who did not need to call it) - This only changes behavior in the case where the hard exit timer expires and will not change the behavior in any other case (other than improving performance)
  - `gracefulExitHandler` will log an error if `force`/`destroySocketsOnHardExit` is `true` but `trackConnections` was not called OR if `force`/`destroySocketsOnHardExit` is `false` but `trackConnections` was called
- `force` deprecated and replaced with `destroySocketsOnHardExit`. Settings passed to `force` will be copied to `destroySocketsOnHardExit`
- `suicideTimeout` deprecated and replaced with `hardExitTimeout`. Settings passed to `suicideTimeout` will be copied to `hardExitTimeout`

# 0.5.2 / 2021-03-29

- Fix registry entry

# 0.5.1 / 2021-03-29

Thank you @techmunk and @kevynb for the typescript work

- Typescript definitions
- Security patch addressing vulnerability with update to underscore version

# 0.5.0 / 2019-10-21

Changes reflected in the below release candidate versions

# 0.5.0-rc.2 / 2019-10-18

Thank you hhunt for additional testing and the fix PR

- Fix errors in new option to handle a last request, including a crasher

# 0.5.0-rc.1 / 2019-10-15

Thank you hhunt for finding this bug, as well as for the fix PR and test code

Issue #14 fixes, and configuration options for an improved graceful exit:

- Fix side effects from handling of rejected incoming requests
  - Connections are no longer closed prematurely during request processing
  - Rejected requests during graceful exit end cleanly
- Return connection close header with response(s), if any
- Add option to perform one last request per connection
- Add option to respond with default or custom http error for rejected requests

# 0.4.2 / 2018-09-30

- Fix undefined socket array error
- Use intended exit code upon forced exit after timeout

# 0.4.1 / 2018-01-15

- Names for anonymous functions, for better stack traces

# 0.4.0 / 2017-03-19

- Support disconnect for more socket.io versions

# 0.3.2 / 2016-08/05

- Released version to npm
- This version entry, npm keeping me honest

# 0.3.1 / 2016-08/05

- Doc format fixes

# 0.3.0 / 2016-08/05

- Released version to npm
- Configurable delay for timer that calls process exit
- Hard exit function now obeys exitProcess option
- Doc updates, options in table format

# 0.2.1 / 2016-07-27

- Released version to npm
- Updated package metadata, version string
- Code style overhaul, many semicolons

# 0.2.0 / 2016-07-26

Thanks to shaharke for the majority of these changes.

- Delay process exit to allow any streams to flush, etc.
- Option to force close sockets on timeout
- Minor doc and logging improvements

Issue #1 feature request and fixes:

- Exit handler callback when done or on timeout
- Option for exit handler to not exit process itself
- Clear hard exit timeout on successful server close
- Avoid duplicate callback invocation

# 0.1.0 / 2013-03-28

- Released version to npm
- Don't keep track of Keep-Alive connections
- Switch to not catching the exit message on our own

# 0.0.2 / 2013-03-26

- Typo fix in README

# 0.0.1 / 2013-03-26

- Initial Release
