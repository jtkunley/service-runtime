import type { ServiceConfig } from "../config/service-config.js";
import { createRequestContext } from "../context/request-context.js";
import type { ContextStore } from "../context/types.js";
import { createContextMiddleware } from "../http/middleware.js";
import type { HostProcess } from "../lifecycle/host-process.js";
import { startService, type ShutdownState } from "./start-service.js";
import type { Service } from "./types.js";

/** Builds a service from validated configuration without opening sockets or touching `process`. */
export function createService(
  config: ServiceConfig,
  host: HostProcess,
): Service<ContextStore, string> {
  const contextLog = config.logger.child("server", "context");
  const requestContext = createRequestContext(config);

  let shuttingDown = false;
  const state: ShutdownState = {
    isShuttingDown: () => shuttingDown,
    markShuttingDown: () => {
      shuttingDown = true;
    },
  };

  const service: Service<ContextStore, string> = {
    context: requestContext.context,
    middleware: createContextMiddleware(requestContext, contextLog),
    isShuttingDown: state.isShuttingDown,
    listen: (app) => startService({ config, app, host, state }),
  };
  return Object.freeze(service);
}
