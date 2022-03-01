// To run this example:
// - `npm i`
// - `npx ts-node src/examples/index.ts`
import express, { Express, Request, Response } from 'express';
import http from 'http';
import * as gracefulExit from '../index';

let handledShutdown = false;
const shutdownConfig: gracefulExit.Configuration = {
  performLastRequest: true,
  exitProcess: true,
  serverCloseMinDelay: 5000,
};
const port = 3000;

// Signal handler
function shutdownSignalHandler(
  message: NodeJS.Signals,
  app: Express,
  server: http.Server,
  logger: (msg: string) => void,
) {
  if (handledShutdown) return;
  handledShutdown = true;
  logger(`Shutdown signal received. Message: ${message}`);
  gracefulExit.gracefulExitHandler(app, server, shutdownConfig);
}

function installSignalHandler(
  app: Express,
  server: http.Server,
  logger: (msg: string) => void,
): void {
  // Connect signal handler for graceful shutdown signals
  process.on('SIGTERM', (message) => shutdownSignalHandler(message, app, server, logger));
  process.on('SIGINT', (message) => shutdownSignalHandler(message, app, server, logger));
  process.on('SIGHUP', (message) => shutdownSignalHandler(message, app, server, logger));
}

const app = express();

// Register the express-graceful-exit middleware
app.use(gracefulExit.middleware(app));

// Configure some routes
// eslint-disable-next-line @typescript-eslint/no-misused-promises,@typescript-eslint/require-await
app.get('/someRequest', async (req: Request, res: Response): Promise<void> => {
  console.log('someRequest');
  res.json({ route: 'someRequest' });
});
app.get('/healthcheck', (req: Request, res: Response): void => {
  console.log('healthcheck');
  res.json({ route: 'healthcheck' });
});

// Listen for connections
const server = app.listen(port);

// Ensure connections stay open at least as long as our load balancer expects them to stay open
server.keepAliveTimeout = 120 * 1000;
// For node v12 and earlier, ensure that we do not reject pre-established connections (e.g. from an AWS Classic HTTP ELB)
// that do not send headers for a request for up to the expected idle timeout (e.g. 60 seconds).
server.headersTimeout = 120 * 1000;

// Listen for the shutdown signals
installSignalHandler(app, server, (message) => {
  console.log(message);
});
