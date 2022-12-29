"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var underscore_1 = __importDefault(require("underscore"));
var base64id_1 = __importDefault(require("base64id"));
var configuration_1 = require("./configuration");
var util_1 = require("util");
var sleep = util_1.promisify(setTimeout);
var RejectionError = /** @class */ (function (_super) {
    __extends(RejectionError, _super);
    function RejectionError(m) {
        var _this = _super.call(this, m) || this;
        _this.name = 'RejectionError';
        _this.headers = {};
        // Set the prototype explicitly.
        Object.setPrototypeOf(_this, RejectionError.prototype);
        return _this;
    }
    return RejectionError;
}(Error));
exports.RejectionError = RejectionError;
var Middleware = /** @class */ (function () {
    function Middleware() {
        this.exitRequestedDate = 0;
        this.serverClosedOnce = false;
        this.sockets = {};
        this._socketCount = 0;
        this._options = configuration_1.DefaultOptions;
        this.connectionsClosed = false;
        this._draining = false;
        this.trackingSockets = false;
        this.exitCalled = false;
        this.hardExitHandler = this.hardExitHandler.bind(this);
    }
    Object.defineProperty(Middleware.prototype, "draining", {
        get: function () {
            return this._draining;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Middleware.prototype, "gracefulExitHandlerCallTime", {
        get: function () {
            return this.exitRequestedDate;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Middleware.prototype, "options", {
        get: function () {
            // Make a copy so it's not modified
            return __assign({}, this._options);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Middleware.prototype, "socketCount", {
        get: function () {
            return this._socketCount;
        },
        enumerable: true,
        configurable: true
    });
    Middleware.prototype.logger = function (str) {
        if (this._options.log && this._options.logger !== undefined) {
            this._options.logger(str);
        }
    };
    Middleware.prototype.initiateGracefulExit = function (server, options) {
        if (options === void 0) { options = {}; }
        return __awaiter(this, void 0, void 0, function () {
            var getConnectionsAsync, remainingMinDelay, _a, msSinceExitRequested, connectionCount, error_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 7, , 8]);
                        // Record when this function was called to more accurately follow specified timer options
                        this.exitRequestedDate = Date.now();
                        // Signal the Express middleware to start responding with `connection: close` headers
                        this._draining = true;
                        // Merge the default options and passed-in options
                        this._options = underscore_1.default.defaults(options, configuration_1.DefaultOptions);
                        // If a logger was passed it's implied that log should be true if not specified
                        if (options.logger != null && options.log == null) {
                            // @ts-expect-error allow overwriting this option
                            this._options.log = true;
                        }
                        // Logger works after options are assigned
                        this.logger('Initiating graceful exit');
                        if (this._options.callback) {
                            if (!underscore_1.default.isFunction(this._options.callback)) {
                                this.logger('Ignoring callback option that is not a function');
                            }
                            else if (this._options.exitProcess) {
                                this.logger("Callback has " + this._options.exitDelay + " ms to complete before hard exit");
                            }
                        }
                        // Handle renamed options
                        if (this._options.hardExitTimeout == null) {
                            // @ts-expect-error allow overwriting this renamed option
                            this._options.hardExitTimeout = options.suicideTimeout;
                        }
                        if (this._options.destroySocketsOnHardExit == null) {
                            // @ts-expect-error allow overwriting this renamed option
                            this._options.destroySocketsOnHardExit = options.force;
                        }
                        // Check for unnecessary connection tracking
                        if (!this._options.destroySocketsOnHardExit && this.trackingSockets) {
                            console.warn('Connection tracking is enabled but is only done if `destroySocketsOnHardExit` is `true`. Ignoring flag');
                        }
                        // Check for necessary but missing connection tracking
                        if (this._options.destroySocketsOnHardExit && !this.trackingSockets) {
                            console.error('Connection tracking inactive but `destroySocketsOnHardExit` is `true`. Not tracking');
                        }
                        if (this._options.serverCloseMinDelay !== undefined &&
                            this._options.serverCloseMinDelay > this._options.serverCloseMaxDelay) {
                            console.warn("Since min is larger than the max, setting serverCloseMinDelay to serverCloseMaxDelay");
                            this._options.serverCloseMinDelay = this._options.serverCloseMaxDelay;
                        }
                        if (this._options.errorDuringExit === false && this._options.performLastRequest === false) {
                            console.error('`errorDuringExit` and `performLastRequest` both `false`, requests ignored yet respond with a `200`');
                        }
                        getConnectionsAsync = util_1.promisify(server.getConnections.bind(server));
                        if (!(this._options.serverCloseMinDelay !== undefined)) return [3 /*break*/, 2];
                        _a = this._options.serverCloseMinDelay;
                        return [4 /*yield*/, sleep()];
                    case 1:
                        remainingMinDelay = _a -
                            (_b.sent());
                        _b.label = 2;
                    case 2:
                        if (!true) return [3 /*break*/, 5];
                        msSinceExitRequested = Date.now() - this.exitRequestedDate;
                        return [4 /*yield*/, getConnectionsAsync()];
                    case 3:
                        connectionCount = _b.sent();
                        if (connectionCount <= 0 ||
                            msSinceExitRequested > this._options.serverCloseMaxDelay ||
                            msSinceExitRequested > this._options.hardExitTimeout) {
                            return [3 /*break*/, 5];
                        }
                        return [4 /*yield*/, sleep(50)];
                    case 4:
                        _b.sent();
                        return [3 /*break*/, 2];
                    case 5: 
                    // Initiate the server close
                    return [4 /*yield*/, this.callServerClose(server)];
                    case 6:
                        // Initiate the server close
                        _b.sent();
                        return [3 /*break*/, 8];
                    case 7:
                        error_1 = _b.sent();
                        console.error("Unexpected exception during shutdown loop: " + error_1);
                        return [3 /*break*/, 8];
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    Middleware.prototype.disconnectSocketIOClients = function () {
        var _a;
        if (((_a = this._options.socketio) === null || _a === void 0 ? void 0 : _a.sockets) == null) {
            throw new Error('`disconnectSocketIOClients` called but `options.socketio` is invalid');
        }
        var sockets = this._options.socketio.sockets;
        var connectedSockets;
        if (typeof (sockets === null || sockets === void 0 ? void 0 : sockets.sockets) === 'object' && !Array.isArray(sockets.sockets)) {
            // socket.io 1.4+
            connectedSockets = underscore_1.default.values(sockets.sockets);
        }
        else if (sockets.sockets && sockets.sockets.length) {
            // socket.io 1.0-1.3
            connectedSockets = sockets.sockets;
        }
        else if (typeof sockets.clients === 'function') {
            // socket.io 0.x
            connectedSockets = sockets.clients();
        }
        if (typeof this._options.socketio.close === 'function') {
            this._options.socketio.close();
        }
        if (connectedSockets && connectedSockets.length) {
            this.logger("Killing " + connectedSockets.length + " socket.io sockets");
            connectedSockets.forEach(function (socket) {
                socket.disconnect();
            });
        }
    };
    Middleware.prototype.callServerClose = function (server) {
        return __awaiter(this, void 0, void 0, function () {
            var msSinceExitRequested, remainingHardExitDelay;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.serverClosedOnce) {
                            return [2 /*return*/];
                        }
                        this.serverClosedOnce = true;
                        msSinceExitRequested = Date.now() - this.exitRequestedDate;
                        if (this.options.exitProcess) {
                            remainingHardExitDelay = Math.max(0, this._options.hardExitTimeout - msSinceExitRequested);
                            this.hardExitTimer = setTimeout(function () { return void _this.hardExitHandler(); }, remainingHardExitDelay);
                        }
                        this.logger("Closing down the http server's listening socket");
                        // server.close closes the listening socket now, all future incoming requests are ignored
                        return [4 /*yield*/, util_1.promisify(server.close.bind(server))()];
                    case 1:
                        // server.close closes the listening socket now, all future incoming requests are ignored
                        _a.sent();
                        this.logger('No longer accepting connections');
                        // Disconnect all the socket.io clients
                        if (this._options.socketio) {
                            this.disconnectSocketIOClients();
                        }
                        // Everything was closed successfully, mission accomplished!
                        this.connectionsClosed = true;
                        // if a hard exit occurs this never runs
                        return [4 /*yield*/, this.exit(0)];
                    case 2:
                        // if a hard exit occurs this never runs
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    Middleware.prototype.exit = function (code) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.exitCalled) {
                            return [2 /*return*/];
                        }
                        this.exitCalled = true;
                        if (underscore_1.default.isFunction(this._options.callback)) {
                            this._options.callback(code);
                        }
                        if (this.hardExitTimer !== undefined) {
                            clearTimeout(this.hardExitTimer);
                            delete this.hardExitTimer;
                        }
                        if (!this._options.exitProcess) return [3 /*break*/, 2];
                        this.logger("Exiting process with code: " + code);
                        // leave a bit of time to write logs, callback to complete, etc
                        return [4 /*yield*/, sleep(this._options.exitDelay)];
                    case 1:
                        // leave a bit of time to write logs, callback to complete, etc
                        _a.sent();
                        process.exit(code);
                        _a.label = 2;
                    case 2: return [2 /*return*/];
                }
            });
        });
    };
    Middleware.prototype.hardExitHandler = function () {
        return __awaiter(this, void 0, void 0, function () {
            var socketKeys;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.connectionsClosed) {
                            // this condition should never occur, see serverClosedCallback() below.
                            // the user callback, if any, has already been called
                            if (this._options.exitProcess) {
                                process.exit(1);
                            }
                            return [2 /*return*/];
                        }
                        if (this._options.destroySocketsOnHardExit) {
                            socketKeys = Object.keys(this.sockets);
                            this.logger("Destroying " + socketKeys.length + " open sockets");
                            socketKeys.forEach(function (id) {
                                var socket = _this.sockets[id];
                                socket.destroy();
                            });
                        }
                        else {
                            this.logger('Hard exit timer ran out before some connections closed');
                        }
                        return [4 /*yield*/, this.exit(1)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    Middleware.prototype.handleFinalRequests = function (req, res, next) {
        var _a, _b;
        var connection = (req.socket || {});
        // Track whether final rquest has started
        connection.lastRequestStarted = (_a = connection.lastRequestStarted) !== null && _a !== void 0 ? _a : false;
        // Set connection close header on response
        // This informs the caller that the connection is closing and will not accept more requests
        res.set('Connection', 'close');
        if (this._options.performLastRequest && connection.lastRequestStarted === false) {
            this.logger('Server exiting, performing last request for this connection.');
            connection.lastRequestStarted = true;
            return next();
        }
        if (this._options.errorDuringExit) {
            this.logger('Server unavailable, incoming request rejected with error.');
            var rejectionError = ((_b = this._options) === null || _b === void 0 ? void 0 : _b.getRejectionError()) ||
                configuration_1.DefaultOptions.getRejectionError('Server unavailable, no new requests accepted during shutdown');
            return next(rejectionError);
        }
        // Configured to silently drop request without response (deprecated behavior)
        this.logger('Server unavailable, incoming request dropped silently.');
        // Intentionally NOT calling next(), to avoid interference with socket.close()
        res.end();
    };
    Middleware.prototype.trackingSocketsStarted = function () {
        this.trackingSockets = true;
    };
    Middleware.prototype.trackSocketOpen = function (socket) {
        // FID is not exposed so we have to generate an ID just like socket.io does
        socket.trackerId = base64id_1.default.generateId();
        this.sockets[socket.trackerId] = socket;
        this._socketCount++;
    };
    Middleware.prototype.trackSocketClose = function (socket) {
        if (socket.trackerId === undefined || this.sockets[socket.trackerId] === undefined) {
            return;
        }
        // Remove the socket from tracking
        delete this.sockets[socket.trackerId];
        this._socketCount--;
    };
    return Middleware;
}());
exports.Middleware = Middleware;
