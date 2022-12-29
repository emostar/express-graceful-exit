import { SocketIOSocket } from './socketio';

/**
 * Options for `gracefulExitHandler()`
 */
export interface Configuration {
  /**
   * errorDuringExit
   *
   * Deprecated - Returning an error during exit does not work with the graceful shutdown
   * of HTTP sockets to web services.
   *
   * @deprecated v0.5.0
   * @default true
   */
  readonly errorDuringExit?: boolean;

  /**
   * performLastRequest - process the last request received on each socket,
   * returns a `connection: close` response header with that response.
   *
   * When there are no sockets left the listening port will be closed and express will exit.
   *
   * Note: Fail readiness probes (e.g. for kubernetes) to decline future requests,
   * but if liveness probes fail any in-flight requests will likely fail.
   *
   * @default true
   */
  readonly performLastRequest?: boolean;

  /**
   * callback - synchronously called just before Process.exit is called.
   */
  readonly callback?: (code: number) => void;

  /**
   * log - record log output
   *
   * @default false (defaults to true if logger is passed in)
   */
  readonly log?: boolean;

  /**
   * logger - function to record log data
   *
   * @default console.log
   */
  readonly logger?: (message: string) => void;

  /**
   * getRejectionError - Get `Error` to throw if rejecting requests during shutdown.
   *
   * @default 
   */
  readonly getRejectionError: (msg?: string) => Error | undefined;

  /**
   * hardExitTimeout - delay before calling `process.exit` even if graceful shutdown is incomplete.
   *
   * @default 130,000ms - 2 minutes 10 seconds
   */
  readonly hardExitTimeout?: number;

  /**
   * @deprecated v1.0.0 - Renamed to `hardExitTimeout`. Value copied to `hardExitTimeout` for now.
   */
  readonly suicideTimeout?: number;

  /**
   * exitProcess - Call `process.exit` when requests are complete or fail?
   *
   * @default true
   */
  readonly exitProcess?: boolean;

  /**
   * serverCloseMaxDelay - Maximum ms delay after calling `gracefulExitHandler` before
   * `server.close` is called, closing the listening socket, regardless of in-flight requests.
   *
   * Delaying `server.close` allows healthchecks to succeed when load balancers are used.
   *
   * By default `server.close` is called as soon as all of the incoming connections have
   * been closed gracefully,
   *
   * @default 60000 ms (60 seconds)
   */
  readonly serverCloseMaxDelay?: number;

  /**
   * serverCloseMinDelay - Minimum ms delay after `gracefulExitHandler` before `server.close`
   * is called.  If not specified then `server.close` will be called as soon as the incoming
   * socket count reaches 0.
   *
   * Some projects find value setting this to between 5 and 30 seconds (5k - 30k ms) in
   * production environments for load balancers to receive the `connection: close` header.
   *
   * Delaying `server.close` allows healthchecks to succeed when load balancers are used.
   *
   * By default `server.close` is called as soon as all of the incoming connections have
   * been closed gracefully,
   *
   * @default undefined
   */
  readonly serverCloseMinDelay?: number;

  /**
   * exitDelay - Additional delay just before calling `process.exit` when `exitProcess` is `true`.
   *
   * @default 10ms
   */
  readonly exitDelay?: number;

  /**
   * destroySocketsOnHardExit - Is `.destroy` called on sockets still open when the hard exit timer expires?
   *
   * Requires `trackConnections` to be called during initialization to track connections.
   *
   * 2022-02-25 - Renamed from `force` to `destroySocketsOnHardExit`
   *
   * @default false
   */
  readonly destroySocketsOnHardExit?: boolean;

  /**
   * @deprecated 2022-02-25 - Renamed to `destroySocketsOnHardExit. An option with this name will
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
  errorDuringExit: true, // default of false was previously deprecated
  performLastRequest: true, // default of false was previously deprecated
  log: false,
  logger: console.log,
  getRejectionError: (msg?: string): Error => {
    return new Error(msg);
  },
  hardExitTimeout: 2 * 60 * 1000 + 10 * 1000, // 2m10s (nodejs default is 2m)
  exitProcess: true,
  exitDelay: 10, // wait in ms before process.exit, if exitProcess true
  destroySocketsOnHardExit: false,
  serverCloseMaxDelay: 60 * 1000,
};

