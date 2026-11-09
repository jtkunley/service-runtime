import { describe, expect, it } from "vitest";
import { resolveServiceConfig } from "../../src/lib/config/resolve-service-config.js";
import { RecordingLogger } from "../helpers/logger.js";

const logger = new RecordingLogger();

function resolve(overrides: Record<string, unknown> = {}) {
  return resolveServiceConfig({ logger, port: 3000, ...overrides });
}

describe("resolveServiceConfig", () => {
  it("applies defaults", () => {
    const config = resolve();

    expect(config).toEqual({
      logger,
      port: 3000,
      host: undefined,
      context: [],
      destinations: new Map(),
      probes: { readiness: "/readiness", liveness: "/liveness" },
      cleanups: [],
      keepAliveTimeoutMs: 65_000,
      shutdownSignals: ["SIGTERM", "SIGINT"],
      forceExitMs: 30_000,
      onShutdownStart: undefined,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("keeps supplied settings", () => {
    const cleanup = () => undefined;
    const onShutdownStart = () => undefined;
    const config = resolve({
      host: "127.0.0.1",
      cleanups: [cleanup],
      keepAliveTimeoutMs: 5_000,
      forceExitMs: 10_000,
      onShutdownStart,
    });

    expect(config).toMatchObject({
      host: "127.0.0.1",
      cleanups: [cleanup],
      keepAliveTimeoutMs: 5_000,
      forceExitMs: 10_000,
      onShutdownStart,
    });
  });

  it("snapshots the cleanup list", () => {
    const cleanups = [() => undefined];
    const config = resolve({ cleanups });
    cleanups.push(() => undefined);

    expect(config.cleanups).toHaveLength(1);
  });

  it.each([null, "options", []])("rejects options %j", (options) => {
    expect(() => resolveServiceConfig(options)).toThrow(new TypeError("options must be an object"));
  });

  it.each([undefined, {}, { child: "nope" }])("rejects logger %j", (badLogger) => {
    expect(() => resolve({ logger: badLogger })).toThrow(
      new TypeError("logger must provide a child(module, action) function"),
    );
  });

  it("rejects a non-function logger.flush", () => {
    expect(() => resolve({ logger: { child: () => undefined, flush: true } })).toThrow(
      new TypeError("logger.flush must be a function"),
    );
  });

  it.each([0, 65_535])("accepts port %d", (port) => {
    expect(resolve({ port }).port).toBe(port);
  });

  it.each([-1, 65_536, 80.5, "80", undefined, Number.NaN])("rejects port %j", (port) => {
    expect(() => resolve({ port })).toThrow(
      new RangeError("port must be an integer from 0 through 65535"),
    );
  });

  it("rejects a non-string host", () => {
    expect(() => resolve({ host: 127 })).toThrow(new TypeError("host must be a string"));
  });

  it.each([1, 2_147_482_647])("accepts keepAliveTimeoutMs %d", (keepAliveTimeoutMs) => {
    expect(resolve({ keepAliveTimeoutMs }).keepAliveTimeoutMs).toBe(keepAliveTimeoutMs);
  });

  it.each([0, 2_147_482_648, 1.5])("rejects keepAliveTimeoutMs %d", (keepAliveTimeoutMs) => {
    expect(() => resolve({ keepAliveTimeoutMs })).toThrow(
      new RangeError("keepAliveTimeoutMs must be an integer from 1 through 2147482647"),
    );
  });

  it.each([1, 2_147_483_647])("accepts forceExitMs %d", (forceExitMs) => {
    expect(resolve({ forceExitMs }).forceExitMs).toBe(forceExitMs);
  });

  it.each([0, 2_147_483_648, 1.5])("rejects forceExitMs %d", (forceExitMs) => {
    expect(() => resolve({ forceExitMs })).toThrow(
      new RangeError("forceExitMs must be an integer from 1 through 2147483647"),
    );
  });

  it("rejects invalid cleanups and onShutdownStart", () => {
    expect(() => resolve({ cleanups: () => undefined })).toThrow(
      new TypeError("cleanups must be an array of functions"),
    );
    expect(() => resolve({ onShutdownStart: "later" })).toThrow(
      new TypeError("onShutdownStart must be a function"),
    );
  });

  it("validates context, destinations, probes, and signals", () => {
    expect(() => resolve({ context: { tenant: {} } })).toThrow(TypeError);
    expect(() => resolve({ destinations: { billing: ["tenant"] } })).toThrow(TypeError);
    expect(() => resolve({ probes: { readiness: "ready" } })).toThrow(TypeError);
    expect(() => resolve({ shutdownSignals: ["SIGKILL"] })).toThrow(TypeError);
  });
});
