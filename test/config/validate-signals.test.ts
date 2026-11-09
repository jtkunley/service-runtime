import { describe, expect, it } from "vitest";
import { validateShutdownSignals } from "../../src/lib/config/validate-signals.js";

describe("validateShutdownSignals", () => {
  it("defaults to SIGTERM and SIGINT", () => {
    expect(validateShutdownSignals(undefined)).toEqual(["SIGTERM", "SIGINT"]);
  });

  it("accepts a custom list and removes duplicates", () => {
    const signals = validateShutdownSignals(["SIGUSR2", "SIGTERM", "SIGUSR2"]);

    expect(signals).toEqual(["SIGUSR2", "SIGTERM"]);
    expect(Object.isFrozen(signals)).toBe(true);
  });

  it.each([[], "SIGTERM", null])("rejects %j", (signals) => {
    expect(() => validateShutdownSignals(signals)).toThrow(
      new TypeError("shutdownSignals must be a non-empty array of signal names"),
    );
  });

  it.each(["SIGNOPE", "sigterm", 15, "toString"])("rejects unknown signal %j", (signal) => {
    expect(() => validateShutdownSignals([signal])).toThrow(
      new TypeError(`Unknown shutdown signal: ${String(signal)}`),
    );
  });

  it.each(["SIGKILL", "SIGSTOP"])("rejects uncatchable signal %s", (signal) => {
    expect(() => validateShutdownSignals(["SIGTERM", signal])).toThrow(
      new TypeError(`Shutdown signal ${signal} cannot be caught`),
    );
  });
});
