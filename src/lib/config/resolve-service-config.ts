import type { Logger } from "../logging/logger.js";
import {
  DEFAULT_FORCE_EXIT_MS,
  DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
  MAX_KEEP_ALIVE_TIMEOUT_MS,
  MAX_PORT,
  MAX_TIMER_MS,
} from "./defaults.js";
import type { ServiceConfig } from "./service-config.js";
import { validateContextEntries, validateDestinations } from "./validate-context.js";
import { validateProbes } from "./validate-probes.js";
import { validateShutdownSignals } from "./validate-signals.js";
import {
  isRecord,
  optionalFunction,
  optionalString,
  requireFunctionList,
  requireIntegerInRange,
  requireRecord,
} from "./validators.js";

/** Validates options, applies defaults, and snapshots the result. Throws on invalid input. */
export function resolveServiceConfig(input: unknown): ServiceConfig {
  const options = requireRecord("options", input);
  const context = validateContextEntries(options.context);

  return Object.freeze({
    logger: requireLogger(options.logger),
    port: requireIntegerInRange("port", options.port, 0, MAX_PORT),
    host: optionalString("host", options.host),
    context,
    destinations: validateDestinations(options.destinations, context),
    probes: validateProbes(options.probes),
    cleanups: requireFunctionList("cleanups", options.cleanups ?? []),
    keepAliveTimeoutMs: requireIntegerInRange(
      "keepAliveTimeoutMs",
      options.keepAliveTimeoutMs ?? DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
      1,
      MAX_KEEP_ALIVE_TIMEOUT_MS,
    ),
    shutdownSignals: validateShutdownSignals(options.shutdownSignals),
    forceExitMs: requireIntegerInRange(
      "forceExitMs",
      options.forceExitMs ?? DEFAULT_FORCE_EXIT_MS,
      1,
      MAX_TIMER_MS,
    ),
    onShutdownStart: optionalFunction("onShutdownStart", options.onShutdownStart),
  });
}

function requireLogger(logger: unknown): Logger {
  if (!isRecord(logger) || typeof logger.child !== "function") {
    throw new TypeError("logger must provide a child(module, action) function");
  }
  optionalFunction("logger.flush", logger.flush);
  return logger as unknown as Logger;
}
