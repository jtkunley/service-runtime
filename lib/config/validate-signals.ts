import { constants } from "node:os";
import { DEFAULT_SHUTDOWN_SIGNALS } from "./defaults.js";

const UNCATCHABLE_SIGNALS = new Set(["SIGKILL", "SIGSTOP"]);

export function validateShutdownSignals(signals: unknown): readonly NodeJS.Signals[] {
  if (signals === undefined) return DEFAULT_SHUTDOWN_SIGNALS;
  if (!Array.isArray(signals) || signals.length === 0) {
    throw new TypeError("shutdownSignals must be a non-empty array of signal names");
  }

  for (const signal of signals as unknown[]) {
    if (typeof signal !== "string" || !Object.hasOwn(constants.signals, signal)) {
      throw new TypeError(`Unknown shutdown signal: ${String(signal)}`);
    }
    if (UNCATCHABLE_SIGNALS.has(signal)) {
      throw new TypeError(`Shutdown signal ${signal} cannot be caught`);
    }
  }

  return Object.freeze([...new Set(signals as NodeJS.Signals[])]);
}
