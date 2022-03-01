/// <reference types="jest" />
import { promisify } from 'util';
import chai from 'chai';
import express, { Express, Request, Response } from 'express';
import fetch from 'node-fetch';
import http from 'http';
import https from 'https';
import chaiHttp from 'chai-http';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import * as gracefulExit from './graceful-exit';
import { Middleware, RejectionError } from './middleware';

// Setup chai middleware
// sinonChai allows testing the express app without having to listen on a port
chai.use(sinonChai);
// chaiAsPromised allowed using async/await on the sinonChai request to the express app
chai.use(chaiAsPromised);

// Configure chai-http
chai.use(chaiHttp);
chai.should();

const sleep = promisify(setTimeout);

// Enable HTTP keep-alive (reuse of connections to services instead of 1 request / connection)
// This is so that aborted server connections will cause an error instead
// of assuming that the full response was received.
const keepAliveOptions = {
  keepAlive: true,
};
http.globalAgent = new http.Agent(keepAliveOptions);
https.globalAgent = new https.Agent(keepAliveOptions);

const port = process.env.PORT || 8086;

function setupApp(): { app: Express; server: http.Server; state: Middleware } {
  const app = express();
  app.use(gracefulExit.middleware(app));

  const state = app.get('gracefulExit_state') as Middleware;

  // Configure express-graceful-exit
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  app.get('/sleep', async (req: Request, res: Response): Promise<void> => {
    await sleep(1000);
    res.json({});
  });
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  app.get('/healthcheck', async (req: Request, res: Response): Promise<void> => {
    await sleep(0);
    res.json({});
  });
  const server = app.listen(port);

  return { app, server, state };
}

describe('routes', () => {
  let server: http.Server;
  let app: Express;
  let state: Middleware;
  const exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {
    // Do nothing
    return {} as never;
  });

  describe('correct init with connection tracking', () => {
    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    beforeEach(() => {
      const setup = setupApp();
      app = setup.app;
      server = setup.server;
      state = setup.state;

      // Track connection open/closing so we can gracefully close them on shutdown
      gracefulExit.trackConnections(server, app);

      // https://nodejs.org/api/http.html#http_server_timeout
      server.headersTimeout = 120 * 1000;

      // https://nodejs.org/api/http.html#http_server_keepalivetimeout
      server.keepAliveTimeout = 120 * 1000;

      exitMock.mockReset();
    });

    describe('socket tracking', () => {
      it('destroys sockets during hard exit if sockets remain open past hardExitTimeout', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        const res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Should be 1 socket
        const getConnectionsAsync = promisify(server.getConnections.bind(server));
        let connections = await getConnectionsAsync();
        expect(connections).toBe(1);
        expect(state.socketCount).toBe(1);

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: true,
          serverCloseMaxDelay: 2000,
          hardExitTimeout: 3000,
          destroySocketsOnHardExit: true,
        });

        // Do not send a request so the hard exit gets called

        // Wait past the hard exit timer
        await sleep(3500);

        // Should be 1 socket because `destroySocketsOnHardExit` is `false`
        connections = await getConnectionsAsync();
        expect(connections).toBe(0);
        expect(state.socketCount).toBe(0);

        // Confirm that process.exit was called
        expect(exitMock).toHaveBeenCalledTimes(1);
        expect(exitMock).lastCalledWith(1);

        // Socket should be destroyed so request should fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      }, 10000);

      it('counts sockets correctly when not closing', async () => {
        expect(state.socketCount).toBe(0);

        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        expect(res.headers.get('connection')).toBe('keep-alive');

        // 1 should be open
        expect(state.socketCount).toBe(1);

        // Use a sleep request to block the first socket
        // Then send another requst at the same time to force another socket to open
        const resSleepPromise = fetch(`http://127.0.0.1:${port}/sleep`, {
          headers: {
            connection: 'keep-alive',
          },
          timeout: 2000,
        });
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
          timeout: 500,
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Resolve the sleep request
        res = await resSleepPromise;
        expect(res.status).toBe(200);
        const jsonRes = await res.json();
        expect(jsonRes).toEqual({});
        expect(res.headers.get('connection')).toBe('keep-alive');

        // 2 should be open
        expect(state.socketCount).toBe(2);

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: false,
        });

        // Close one socket
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'close',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('close');
        await sleep(500);

        // 1 should be open
        expect(state.socketCount).toBe(1);

        // Close the other socket
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'close',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('close');
        await sleep(500);

        // 0 should be open
        expect(state.socketCount).toBe(0);
      }, 10000);
    });
  });

  describe('correct init without connection tracking', () => {
    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    beforeEach(() => {
      const setup = setupApp();
      app = setup.app;
      server = setup.server;
      state = setup.state;

      // https://nodejs.org/api/http.html#http_server_timeout
      server.headersTimeout = 120 * 1000;

      // https://nodejs.org/api/http.html#http_server_keepalivetimeout
      server.keepAliveTimeout = 120 * 1000;

      exitMock.mockReset();
    });

    describe('simple routes', () => {
      it('/sleep', async () => {
        const res = await chai.request(app).get('/sleep');
        expect(res.status).toBe(200);
        expect(res.header).toHaveProperty('connection');
        expect(res.get('connection')).toBe('close');
      });

      it('/healthcheck', async () => {
        const res = await chai.request(app).get('/healthcheck');
        expect(res.status).toBe(200);
        expect(res.header).toHaveProperty('connection');
        expect(res.get('connection')).toBe('close');
      });

      it('/does_not_exist', async () => {
        const res = await chai.request(app).get('/does_not_exist');
        expect(res.header).toHaveProperty('connection');
        expect(res.get('connection')).toBe('close');
      });
    });

    describe('exitProcess false', () => {
      it('refuses connections after all existing connections closed gracefully', async () => {
        // chai-http doesn't seem to let us set the keep-alive header and it's not getting picked up from
        // the default, so we use fetch instead
        // let res = await chai.request(app).get('/does_not_exist');
        // expect(res).to.have.status(404);
        // expect(res.header).to.have.property('connection');
        // expect(res.get('connection')).to.equal('close');

        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: false,
        });

        // Confirm that we can send 1 last request on our 1 socket
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        expect(res.headers.get('connection')).toBe('close');

        // Wait a bit
        await sleep(1000);

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      });
    });

    describe('more obscure features', () => {
      let consoleLogMock: jest.SpyInstance;
      let consoleErrorMock: jest.SpyInstance;

      beforeEach(() => {
        consoleLogMock = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorMock = jest.spyOn(console, 'error').mockImplementation();
      });

      afterEach(() => {
        consoleLogMock.mockRestore();
        consoleErrorMock.mockRestore();
      });

      it('errors and continues when gracefulExitHandler called twice', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: false,
        });

        // Accidentally call twice
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: false,
        });

        expect(consoleErrorMock).toBeCalledTimes(1);
        expect(consoleErrorMock).toBeCalledWith(
          'express-graceful-exit - gracefulExitHandler called more than once - ignoring',
        );

        // Confirm that we can send 1 last request on our 1 socket
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        expect(res.headers.get('connection')).toBe('close');

        // Wait a bit
        await sleep(1000);

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      });

      it('silently drops requests during shutdown - not suggested', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: false,
          errorDuringExit: false,
          exitProcess: false,
        });

        // Confirm that last request does not call route
        const startTime = Date.now();
        res = await fetch(`http://127.0.0.1:${port}/sleep`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        await res.text();
        expect(res.status).toBe(200);
        expect(res.headers.get('connection')).toBe('close');
        expect(Date.now() - startTime).toBeLessThan(1000);

        // Wait a bit
        await sleep(1000);

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      });

      it('calls callback in exit', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Initiate the shutdown
        const shutdownCallback = jest.fn();
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: false,
          callback: shutdownCallback,
        });

        // Confirm that we can send 1 last request on our 1 socket
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        expect(res.headers.get('connection')).toBe('close');

        // Wait a bit
        await sleep(1000);

        // Check callback
        expect(shutdownCallback).toBeCalledTimes(1);
        expect(shutdownCallback).toHaveBeenLastCalledWith(0);

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      });

      it('ignores invalid callback in exit', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: false,
          log: true,
          logger: (message) => {
            console.log(`wrapped log: ${message}`);
          },
          callback: 'fakeShutdownCallback' as unknown as () => void,
        });

        expect(consoleLogMock).lastCalledWith(
          'wrapped log: Ignoring callback option that is not a function',
        );

        // Confirm that we can send 1 last request on our 1 socket
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        expect(res.headers.get('connection')).toBe('close');

        // Wait a bit
        await sleep(1000);

        // Check logger
        expect(consoleLogMock).toBeCalledTimes(5);
        expect(consoleLogMock).lastCalledWith('wrapped log: No longer accepting connections');

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      });

      it('deprecated options still applied', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          force: true,
          suicideTimeout: 311 * 10,
        });

        const state = app.get('gracefulExit_state') as Middleware;
        const { options } = state;

        // Check that the deprecated options were copied to the renamed options
        expect(options.destroySocketsOnHardExit).toBe(true);
        expect(options.suicideTimeout).toBe(311 * 10);

        // Confirm that last request does not call route
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        await res.text();
        expect(res.status).toBe(404);
        expect(res.headers.get('connection')).toBe('close');

        // Wait a bit
        await sleep(1000);

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      });
    });

    describe('logging', () => {
      let consoleLogMock: jest.SpyInstance;

      beforeEach(() => {
        consoleLogMock = jest.spyOn(console, 'log').mockImplementation();
      });

      afterEach(() => {
        consoleLogMock.mockRestore();
      });

      // the console.log mock doesn't replace the console.log reference in default options
      it.skip('default logger enabled', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: false,
          log: true,
        });

        // Confirm that we can send 1 last request on our 1 socket
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        expect(res.headers.get('connection')).toBe('close');

        // Wait a bit
        await sleep(1000);

        // Check logger
        expect(consoleLogMock).toBeCalledTimes(3);
        expect(consoleLogMock).lastCalledWith('cat');

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      });

      it('custom logger provided', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: false,
          log: true,
          logger: (message) => {
            console.log(`wrapped log: ${message}`);
          },
        });

        // Confirm that we can send 1 last request on our 1 socket
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        expect(res.headers.get('connection')).toBe('close');

        // Wait a bit
        await sleep(1000);

        // Check logger
        expect(consoleLogMock).toBeCalledTimes(4);
        expect(consoleLogMock).lastCalledWith('wrapped log: No longer accepting connections');

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      });
    });

    describe('error response on exit - not suggested', () => {
      it('returns 500 by default to last request', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Should be 1 socket
        const getConnectionsAsync = promisify(server.getConnections.bind(server));
        let connections = await getConnectionsAsync();
        expect(connections).toBe(1);

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: false,
          errorDuringExit: true,
        });

        // Should still be 1 socket
        connections = await getConnectionsAsync();
        expect(connections).toBe(1);

        // Confirm that we get an error
        const startTime = Date.now();
        res = await fetch(`http://127.0.0.1:${port}/sleep`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        await res.text();
        expect(res.status).toBe(500);
        expect(res.headers.get('connection')).toBe('close');
        expect(Date.now() - startTime).toBeLessThan(1000);

        // Wait a tick
        await sleep(500);

        // Should be 0 sockets
        connections = await getConnectionsAsync();
        expect(connections).toBe(0);

        // Wait a bit
        await sleep(3000);

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
            timeout: 200,
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      }, 10000);

      it('error response is customizable on last request', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Should be 1 socket
        const getConnectionsAsync = promisify(server.getConnections.bind(server));
        let connections = await getConnectionsAsync();
        expect(connections).toBe(1);

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: false,
          errorDuringExit: true,
          getRejectionError: () => {
            const error = new RejectionError('custom error');
            error.status = 503;
            // This doesn't seem to work
            error.statusMessage = 'Service Really Unavailable';
            error.headers.customHeader = 'customValue';
            return error;
          },
        });

        // Confirm that we get an error
        const startTime = Date.now();
        res = await fetch(`http://127.0.0.1:${port}/sleep`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        const body = await res.text();
        expect(body).toContain('custom error');
        expect(res.status).toBe(503);
        expect(res.statusText).toBe('Service Unavailable');
        expect(res.headers.get('connection')).toBe('close');
        expect(res.headers.get('customHeader')).toBe('customValue');
        expect(Date.now() - startTime).toBeLessThan(1000);

        // Wait a tick
        await sleep(500);

        // Should be 0 sockets
        connections = await getConnectionsAsync();
        expect(connections).toBe(0);

        // Wait a bit
        await sleep(3000);

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
            timeout: 200,
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      }, 10000);
    });

    describe('exitProcess true', () => {
      it('calls process.exit when all sockets closed', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Should be 1 socket
        const getConnectionsAsync = promisify(server.getConnections.bind(server));
        let connections = await getConnectionsAsync();
        expect(connections).toBe(1);

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: true,
          serverCloseMinDelay: 2000,
          serverCloseMaxDelay: 4000,
        });

        // Confirm that we can send 1 last request on our 1 socket
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        await res.text();
        expect(res.status).toBe(404);
        expect(res.headers.get('connection')).toBe('close');

        // Wait a bit
        await sleep(5000);

        // Should be 0 socket
        connections = await getConnectionsAsync();
        expect(connections).toBe(0);

        // Confirm that process.exit was called
        expect(exitMock).toHaveBeenCalledTimes(1);

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
            timeout: 200,
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      }, 10000);

      it('performs hard exit if sockets remain open past hardExitTimeout', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Should be 1 socket
        const getConnectionsAsync = promisify(server.getConnections.bind(server));
        let connections = await getConnectionsAsync();
        expect(connections).toBe(1);

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: true,
          serverCloseMaxDelay: 2000,
          hardExitTimeout: 3000,
        });

        // Do not send a request so the hard exit gets called

        // Wait past the hard exit timer
        await sleep(3500);

        // Should be 1 socket because `destroySocketsOnHardExit` is `false`
        connections = await getConnectionsAsync();
        expect(connections).toBe(1);

        // Confirm that process.exit was called
        expect(exitMock).toHaveBeenCalledTimes(1);
        expect(exitMock).lastCalledWith(1);

        // Request after hard exit succeeds because process.exit is mocked
        res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(404);
        await res.text();
        expect(res.headers.get('connection')).toBe('close');
      }, 10000);

      // This may seem counter-intuitive, but it is necessary to continue to allow new connections
      // so that any healthcheck routes will continue to succeed.
      // In Kubernetes, in particular, SIGTERM is sent to the pod before the pod is removed from
      // the service and/or ingress endpoints.  Failing to accept connections immediately after SIGTERM
      // is received will cause `connection refused` errors
      // For ingress-nginx the error will generate a 502 response code and will look like:
      //  2022/02/17 03:10:51 [error] 23025#23025: *3362624832 connect() failed (111: Connection refused) while connecting to upstream, client: 10.0.0.1, server: some.example.com, request: \"GET /my/api/call HTTP/1.1\", upstream: \"http://10.0.0.2:3000/my/api/call\", host: \"some.example.com\"
      it('allows new connections until the last connection has closed', async () => {
        // Setup a socket
        // Because we have keep alive on this socket will remain open
        let res = await fetch(`http://127.0.0.1:${port}/healthcheck`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(200);
        await res.json();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Check it again on the same socket
        res = await fetch(`http://127.0.0.1:${port}/healthcheck`, {
          headers: {
            connection: 'keep-alive',
          },
        });
        expect(res.status).toBe(200);
        await res.json();
        expect(res.headers.get('connection')).toBe('keep-alive');

        // Should be 1 socket
        const getConnectionsAsync = promisify(server.getConnections.bind(server));
        let connections = await getConnectionsAsync();
        expect(connections).toBe(1);

        // Initiate the shutdown
        gracefulExit.gracefulExitHandler(app, server, {
          performLastRequest: true,
          exitProcess: true,
          serverCloseMinDelay: 2000,
          serverCloseMaxDelay: 4000,
          log: false,
        });

        // Use a sleep request to block the first socket
        // Then send another requst at the same time to force another socket to open
        const resSleepPromise = fetch(`http://127.0.0.1:${port}/sleep`, {
          headers: {
            connection: 'keep-alive',
          },
          timeout: 3000,
        });

        const resSleepPromise2 = fetch(`http://127.0.0.1:${port}/sleep`, {
          headers: {
            connection: 'keep-alive',
          },
          timeout: 3000,
        });

        await sleep(100);

        connections = await getConnectionsAsync();
        expect(connections).toBe(2);

        // Resolve the sleep request
        res = await resSleepPromise;
        expect(res.status).toBe(200);
        await res.json();
        expect(res.headers.get('connection')).toBe('close');

        // Resolve the sleep request
        res = await resSleepPromise2;
        expect(res.status).toBe(200);
        await res.json();
        expect(res.headers.get('connection')).toBe('close');

        // Wait for express to exit
        await sleep(4000);

        expect(state.socketCount).toBe(0);

        // Confirm that process.exit was called
        expect(exitMock).toHaveBeenCalledTimes(1);

        // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
        await expect(async () => {
          await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
            headers: {
              connection: 'keep-alive',
            },
          });
        }).rejects.toThrowError(
          'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
        );
      }, 20000);
    });
  });

  describe('incorrect connection tracking', () => {
    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    beforeEach(() => {
      const setup = setupApp();
      app = setup.app;
      server = setup.server;
      state = setup.state;

      // Track connection open/closing so we can gracefully close them on shutdown
      gracefulExit.trackConnections(app as unknown as http.Server, app);

      // https://nodejs.org/api/http.html#http_server_timeout
      server.headersTimeout = 120 * 1000;

      // https://nodejs.org/api/http.html#http_server_keepalivetimeout
      server.keepAliveTimeout = 120 * 1000;
    });

    // Some callers mistakenly pass the Express app to init instead of the http.Server
    // Confirm that this does not work
    it('fails to count sockets correctly when Express app is passed to init()', async () => {
      expect(state.socketCount).toBe(0);

      // Setup a socket
      // Because we have keep alive on this socket will remain open
      let res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
        headers: {
          connection: 'keep-alive',
        },
      });
      await res.text();
      expect(res.status).toBe(404);
      expect(res.headers.get('connection')).toBe('keep-alive');

      // 1 should be open
      // Should be 1 but since this does not work it's 0
      expect(state.socketCount).toBe(0);

      // Initiate the shutdown
      gracefulExit.gracefulExitHandler(app, server, {
        performLastRequest: true,
        exitProcess: false,
        serverCloseMinDelay: 2000,
        serverCloseMaxDelay: 5000,
      });

      // Confirm that a 1st request after shutdown will work because we have a socket open still
      res = await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
        headers: {
          connection: 'keep-alive',
        },
        timeout: 200,
      });
      expect(res.status).toBe(404);

      await sleep(6000);

      // Confirm that we fail to send a 2nd request after shutdown as that would try to open a socket, which will fail
      await expect(async () => {
        await fetch(`http://127.0.0.1:${port}/does_not_exist`, {
          headers: {
            connection: 'keep-alive',
          },
          timeout: 200,
        });
      }).rejects.toThrowError(
        'request to http://127.0.0.1:8086/does_not_exist failed, reason: connect ECONNREFUSED 127.0.0.1:8086',
      );
    }, 10000);
  });
});
