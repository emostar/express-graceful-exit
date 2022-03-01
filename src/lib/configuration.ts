import { SocketIOSocket } from './socketio';

/**
 * Options for `gracefulExitHandler()`
 */
export interface Configuration {
  /**
   * Deprecated - Returning an error during exit does not work with the graceful shutdown
   * of HTTP sockets to web services.
   *
   * @deprecated v0.5.0
   * @default false
   */
  readonly errorDuringExit?: boolean;

  /**
   * Performs the last request received on each socket, returning a `connection: close` response
   * header with that response, then closing the socket as is allowed per the HTTP/1.1 spec.
   *
   * When there are no sockets left the listening port will be closed and express will exit.
   *
   * This prevents callers from seeing any errors when express is gracefully exiting.
   *
   * Note: any readiness probe (e.g. for kubernetes) can be made to fail after the exit
   * signal (e.g. SIGTERM) is received so that new connections will stop being routed to the
   * instance.  Liveness probes (e.g. for kubernetes) should not be made to fail as this
   * can cause the container to exit before the in-flight requests are finished.
   *
   * @default true
   */
  readonly performLastRequest?: boolean;

  /**
   * Callback to be called just before Process.exit is called.
   */
  readonly callback?: (code: number) => void;

  /**
   * Log debugging info
   *
   * @default false
   */
  readonly log?: boolean;

  /**
   * Logger function for debugging info
   *
   * @default console.log
   */
  readonly logger?: (message: string) => void;

  /**
   * Deprecated - Get the `Error` to be raised when rejecting requests during shutdown.
   *
   * @deprecated v0.5.0
   */
  readonly getRejectionError?: (error?: Error) => Error | undefined;

  /**
   * Final timeout (in milliseconds) when `process.exit` should be called even if graceful
   * shutdown has not completed.
   *
   * @default 130,000ms - 2 minutes 10 seconds
   */
  readonly hardExitTimeout?: number;

  /**
   * @deprecated 2022-02-25 - Renamed to `hardExitTimeout`.  Value will be copied to `hardExitTimeout`.
   */
  readonly suicideTimeout?: number;

  /**
   * Call `process.exit` when process is complete or failed?
   *
   * @default true
   */
  readonly exitProcess?: boolean;

  /**
   *
   * Maximum delay (in milliseconds) after `gracefulExitHandler` is called before `server.close` will be called,
   * closing the listening socket.  This ensures that `server.close` is eventually called even if
   * incoming connections continue to be opened, causing the socket count to not reach 0 before
   *
   * `server.close` should NOT be called immediately so that healthchecks will continue to succeed
   * until load balancers have stopped trying to connect to the app (this is particularly an issue in kubernetes
   * where SIGTERM is sent to a pod before the routing of connections to the pod has been cleaned up).
   *
   * `server.close` will normally be called as soon as all of the incoming connections have been closed gracefully,
   * however, it can be called sooner if it is not desired to stay listening for connections and responding with
   * non-200 status codes to healthchecks.
   *
   *
   * @default 60000 ms (60 seconds)
   */
  readonly serverCloseMaxDelay?: number;

  /**
   * Minimum delay (in milliseconds) after `gracefulExitHandler` is called before `server.close` will be called,
   * closing the listening socket.  If not specified then `server.close` will be called as soon as the incoming
   * socket count reaches 0.  It is advised to set this to at least `5000` (5 seconds) when running in a
   * production env and `30000` (30 seconds) is even better.
   *
   * `server.close` should NOT be called immediately so that healthchecks will continue to succeed
   * until load balancers have stopped trying to connect to the app (this is particularly an issue in kubernetes
   * where SIGTERM is sent to a pod before the routing of connections to the pod has been cleaned up).
   *
   * `server.close` will normally be called as soon as all of the incoming connections have been closed gracefully,
   * however, it can be called sooner if it is not desired to stay listening for connections and responding with
   * non-200 status codes to healthchecks.
   *
   * @default undefined
   *
   * @example Set to `30000` on kubernetes to allow probes to succeed and ingress to connect
   * for 30 seconds after receipt of SIGTERM - This will prevent 502s and failed readiness/liveness probes
   * during shutdown.
   */
  readonly serverCloseMinDelay?: number;

  /**
   * Additional delay just before calling `process.exit` when `exitProcess` is `true`.
   *
   * @default 10ms
   */
  readonly exitDelay?: number;

  /**
   * Call `.destroy` on each socket that is still open when the hard exit timer expires.
   *
   * Requires `trackConnections` to be called during initialization to track connections.
   *
   * 2022-02-25 - Renamed from `force` to `destroySocketsOnHardExit`
   *
   * @default false
   */
  readonly destroySocketsOnHardExit?: boolean;

  /**
   * @deprecated 2022-02-25 - Renamed to `destroySocketsOnHardExit.  A value set on this setting will
   * be copied to `destroySocketsOnHardExit`.
   */
  readonly force?: boolean;

  /**
   * Optional closing of Socket.io sockets
   */
  readonly socketio?: {
    close?: () => void;
    sockets: {
      clients?: () => SocketIOSocket[];
      sockets:
        | {
            [key: string]: SocketIOSocket;
          }
        | SocketIOSocket[];
    };
  };
}

type RequiredConfigurationFields = keyof Pick<
  Configuration,
  | 'errorDuringExit'
  | 'performLastRequest'
  | 'log'
  | 'logger'
  | 'getRejectionError'
  | 'hardExitTimeout'
  | 'exitProcess'
  | 'exitDelay'
  | 'destroySocketsOnHardExit'
  | 'serverCloseMaxDelay'
>;

export type RequiredConfiguration = Required<Pick<Configuration, RequiredConfigurationFields>> &
  Omit<Configuration, RequiredConfigurationFields>;

/**
 * Default options for `gracefulExitHandler`
 */
export const DefaultOptions: RequiredConfiguration = {
  errorDuringExit: false, // false is existing behavior, deprecated as of v0.5.0
  performLastRequest: true,
  log: false,
  logger: console.log,
  getRejectionError: (err?: Error): Error | undefined => {
    return err;
  },
  hardExitTimeout: 2 * 60 * 1000 + 10 * 1000, // 2m10s (nodejs default is 2m)
  exitProcess: true,
  exitDelay: 10, // wait in ms before process.exit, if exitProcess true
  destroySocketsOnHardExit: false,
  serverCloseMaxDelay: 60 * 1000,
};
