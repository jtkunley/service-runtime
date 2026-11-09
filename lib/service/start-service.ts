import type { RequestListener, Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ServiceConfig } from "../config/service-config.js";
import { closeServer, createHttpServer, listenOn } from "../http/http-server.js";
import { createProbeHandler } from "../http/probes.js";
import { ExitCoordinator } from "../lifecycle/exit-coordinator.js";
import { createFatalErrorHandlers } from "../lifecycle/fatal-errors.js";
import { createGracefulShutdown } from "../lifecycle/graceful-shutdown.js";
import { ProcessHandlers, type HostProcess } from "../lifecycle/host-process.js";
import { releaseListen, reserveListen } from "../lifecycle/listen-reservation.js";

export interface ShutdownState {
  readonly isShuttingDown: () => boolean;
  readonly markShuttingDown: () => void;
}

export interface StartServiceOptions {
  readonly config: ServiceConfig;
  readonly app: RequestListener;
  readonly host: HostProcess;
  readonly state: ShutdownState;
}

/**
 * Starts the owned HTTP server. Process handlers are installed before the socket accepts traffic;
 * if startup fails, everything this attempt opened or installed is undone before rejecting.
 */
export async function startService(options: StartServiceOptions): Promise<AddressInfo> {
  const { config, app, host, state } = options;
  if (typeof app !== "function") throw new TypeError("listen(app) requires a request listener");

  reserveListen();
  const handlers = new ProcessHandlers(host);
  let server: Server | undefined;

  try {
    const shutdownLog = config.logger.child("server", "shutdown");
    const fatalLog = config.logger.child("server", "fatal");
    const exit = new ExitCoordinator(config.logger, host);

    const handleProbe = createProbeHandler(config.probes, state.isShuttingDown);
    const ownedServer = createHttpServer((request, response) => {
      if (!handleProbe(request, response)) app(request, response);
    }, config.keepAliveTimeoutMs);
    server = ownedServer;

    // A signal can arrive while binding is pending (for example during a hostname lookup).
    const bindAttempt = Promise.withResolvers<undefined>();
    const closeOwnedServer = async () => {
      await bindAttempt.promise;
      if (ownedServer.listening) await closeServer(ownedServer);
    };

    const fatal = createFatalErrorHandlers({
      log: fatalLog,
      exit,
      markShuttingDown: state.markShuttingDown,
    });
    handlers.install("uncaughtException", fatal.uncaughtException);
    handlers.install("unhandledRejection", fatal.unhandledRejection);

    const shutdown = createGracefulShutdown({
      closeServer: closeOwnedServer,
      log: shutdownLog,
      exit,
      onShutdownStart: config.onShutdownStart,
      cleanups: config.cleanups,
      forceExitMs: config.forceExitMs,
      markShuttingDown: state.markShuttingDown,
    });
    for (const signal of config.shutdownSignals) {
      handlers.install(signal, () => {
        shutdown(signal);
      });
    }

    try {
      return await listenOn(ownedServer, config.port, config.host);
    } finally {
      bindAttempt.resolve(undefined);
    }
  } catch (error) {
    server?.close();
    // A shutdown already in progress keeps its handlers so repeated signals stay ignored.
    if (!state.isShuttingDown()) handlers.removeAll();
    releaseListen();
    throw error;
  }
}
