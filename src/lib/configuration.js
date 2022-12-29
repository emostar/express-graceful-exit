"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Default options for `gracefulExitHandler`
 */
exports.DefaultOptions = {
    errorDuringExit: true,
    performLastRequest: true,
    log: false,
    logger: console.log,
    getRejectionError: function (msg) {
        return new Error(msg);
    },
    hardExitTimeout: 2 * 60 * 1000 + 10 * 1000,
    exitProcess: true,
    exitDelay: 10,
    destroySocketsOnHardExit: false,
    serverCloseMaxDelay: 60 * 1000,
};
