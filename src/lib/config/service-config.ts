import type { ContextEntry } from "../context/types.js";
import type { Logger } from "../logging/logger.js";
import type { Cleanup, ShutdownHook } from "../service/types.js";

export interface ContextEntryConfig {
  readonly name: string;
  readonly value: ContextEntry["value"];
  readonly required: boolean;
  readonly header: string | undefined;
}

export interface OutboundHeader {
  readonly entry: string;
  readonly header: string;
}

/** Probe paths, where `undefined` means the probe is disabled. */
export interface ProbePaths {
  readonly readiness: string | undefined;
  readonly liveness: string | undefined;
}

/** Validated, defaulted configuration, copied so later option changes have no effect. */
export interface ServiceConfig {
  readonly logger: Logger;
  readonly port: number;
  readonly host: string | undefined;
  readonly context: readonly ContextEntryConfig[];
  readonly destinations: ReadonlyMap<string, readonly OutboundHeader[]>;
  readonly probes: ProbePaths;
  readonly cleanups: readonly Cleanup[];
  readonly keepAliveTimeoutMs: number;
  readonly shutdownSignals: readonly NodeJS.Signals[];
  readonly forceExitMs: number;
  readonly onShutdownStart: ShutdownHook | undefined;
}
