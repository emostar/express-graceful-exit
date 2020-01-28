import { Server } from 'net'
import { Express, NextFunction, Request, RequestHandler, Response } from 'express'

namespace GracefulExit {
  interface Configuration {
    errorDuringExit?: boolean
    performLastRequest?: boolean
    callback?: (code: number) => void
    log?: boolean
    logger?: (message: string) => void
    getRejectionError?: () => Error
    suicideTimeout?: number
    exitProcess?: boolean
    exitDelay?: number
    force?: boolean
  }

  function init(server: Server): void
  function gracefulExitHandler(app: Express, server: Server, options?: Configuration): void
  function middleware(app: Express): RequestHandler

  function disconnectSocketIOClients(): void
  function hardExitHandler(): void
  function handleFinalRequests(req: Request, res: Response, next: NextFunction): void
}

export = GracefulExit

