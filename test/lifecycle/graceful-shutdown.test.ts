import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExitCoordinator } from "../../src/lib/lifecycle/exit-coordinator.js";
import {
  createGracefulShutdown,
  type GracefulShutdownOptions,
} from "../../src/lib/lifecycle/graceful-shutdown.js";
import type { Cleanup } from "../../src/lib/service/types.js";
import { FakeHost } from "../helpers/host.js";
import { RecordingLogger } from "../helpers/logger.js";

type CloseBehavior = "close" | "fail" | "hang";

function closeServerStub(behavior: CloseBehavior, events: string[]): () => Promise<void> {
  return () => {
    events.push("server closed");
    if (behavior === "close") return Promise.resolve();
    if (behavior === "fail") return Promise.reject(new Error("close failed"));
    return new Promise(() => {});
  };
}

function setup(
  options: Partial<
    Pick<GracefulShutdownOptions, "onShutdownStart" | "cleanups" | "forceExitMs">
  > & {
    close?: CloseBehavior;
    events?: string[];
  } = {},
) {
  const events = options.events ?? [];
  const logger = new RecordingLogger();
  const host = new FakeHost();
  const exit = new ExitCoordinator(logger, host);
  const markShuttingDown = vi.fn(() => events.push("marked shutting down"));
  const shutdown = createGracefulShutdown({
    closeServer: closeServerStub(options.close ?? "close", events),
    log: logger.child("server", "shutdown"),
    exit,
    onShutdownStart: options.onShutdownStart,
    cleanups: options.cleanups ?? [],
    forceExitMs: options.forceExitMs ?? 1_000,
    markShuttingDown,
  });
  return { events, logger, host, exit, markShuttingDown, shutdown };
}

const signal = { signal: "SIGTERM" };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("graceful shutdown", () => {
  it("runs the hook, closes the server, then runs cleanups sequentially in order", async () => {
    const events: string[] = [];
    const later = (label: string, ms: number) => async () => {
      events.push(`${label} started`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`${label} finished`);
    };
    const context = setup({
      events,
      onShutdownStart: later("hook", 10),
      cleanups: [later("first cleanup", 20), later("second cleanup", 5)],
    });

    context.shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(100);

    expect(events).toEqual([
      "marked shutting down",
      "hook started",
      "hook finished",
      "server closed",
      "first cleanup started",
      "first cleanup finished",
      "second cleanup started",
      "second cleanup finished",
    ]);
    expect(context.logger.entries).toEqual([
      {
        scope: "server/shutdown",
        level: "info",
        message: "Received shutdown signal, closing server...",
        data: signal,
      },
      {
        scope: "server/shutdown",
        level: "info",
        message: "Graceful shutdown complete",
        data: signal,
      },
    ]);
    expect(context.host.exitCodes).toEqual([0]);
  });

  it("marks the service as shutting down before the hook settles", () => {
    const { markShuttingDown, shutdown } = setup({ onShutdownStart: () => new Promise(() => {}) });

    shutdown("SIGINT");

    expect(markShuttingDown).toHaveBeenCalledOnce();
  });

  it("runs without an onShutdownStart hook", async () => {
    const { events, host, shutdown } = setup();

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    expect(events).toEqual(["marked shutting down", "server closed"]);
    expect(host.exitCodes).toEqual([0]);
  });

  it("ignores repeated signals without restarting the sequence", async () => {
    const hook = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    const { logger, host, shutdown } = setup({ onShutdownStart: hook });

    shutdown("SIGTERM");
    shutdown("SIGINT");
    await vi.advanceTimersByTimeAsync(50);
    shutdown("SIGTERM");

    expect(hook).toHaveBeenCalledOnce();
    expect(logger.entries.filter((entry) => entry.message.startsWith("Shutdown already"))).toEqual([
      {
        scope: "server/shutdown",
        level: "info",
        message: "Shutdown already in progress, ignoring signal",
        data: { signal: "SIGINT" },
      },
      {
        scope: "server/shutdown",
        level: "info",
        message: "Shutdown already in progress, ignoring signal",
        data: signal,
      },
    ]);
    expect(host.exitCodes).toEqual([0]);
  });

  it("does not start after a fatal or forced exit has been selected", () => {
    const hook = vi.fn();
    const { exit, logger, shutdown } = setup({ onShutdownStart: hook });

    exit.request(1);
    shutdown("SIGTERM");

    expect(hook).not.toHaveBeenCalled();
    expect(logger.messages("server/shutdown")).toEqual([
      "Shutdown already in progress, ignoring signal",
    ]);
  });

  it("continues after an onShutdownStart failure and exits with 1", async () => {
    const failure = new Error("hook failed");
    const { events, logger, host, shutdown } = setup({
      onShutdownStart: () => Promise.reject(failure),
    });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.find("Error in onShutdownStart")).toEqual({
      scope: "server/shutdown",
      level: "error",
      message: "Error in onShutdownStart",
      error: failure,
      data: signal,
    });
    expect(events).toContain("server closed");
    expect(host.exitCodes).toEqual([1]);
  });

  it("continues after a server close failure and exits with 1", async () => {
    const cleanup = vi.fn();
    const { logger, host, shutdown } = setup({ close: "fail", cleanups: [cleanup] });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.find("Error closing server")?.error?.message).toBe("close failed");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.exitCodes).toEqual([1]);
  });

  it("identifies failing cleanups by name or position and keeps going", async () => {
    const last = vi.fn();
    const cleanups: Cleanup[] = [
      function closeDatabase() {
        throw new Error("db failed");
      },
      () => Promise.reject(new Error("anonymous failed")),
      () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- non-Error throws must be wrapped
        throw "not an error";
      },
      last,
    ];
    Object.defineProperty(cleanups[1], "name", { value: "" });
    Object.defineProperty(cleanups[2], "name", { value: "" });
    const { logger, host, shutdown } = setup({ cleanups });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    const failures = logger.entries.filter((entry) => entry.level === "error");
    expect(failures.map((entry) => [entry.message, entry.error?.message])).toEqual([
      ["Error during resource cleanup: closeDatabase", "db failed"],
      ["Error during resource cleanup: #2", "anonymous failed"],
      ["Error during resource cleanup: #3", "not an error"],
    ]);
    expect(failures[2]?.error?.cause).toBe("not an error");
    expect(last).toHaveBeenCalledOnce();
    expect(logger.messages("server/shutdown")).toContain("Graceful shutdown complete");
    expect(host.exitCodes).toEqual([1]);
  });

  it("treats a shutdown logging failure as unsuccessful without stopping the sequence", async () => {
    const cleanup = vi.fn();
    const { logger, host, shutdown } = setup({ cleanups: [cleanup] });
    logger.throwOnLog = (entry) => entry.message.startsWith("Received");

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.exitCodes).toEqual([1]);
  });

  it("treats a failure to log an ignored signal as unsuccessful", async () => {
    const hook = Promise.withResolvers<void>();
    const { logger, host, shutdown } = setup({ onShutdownStart: () => hook.promise });
    logger.throwOnLog = (entry) => entry.message.startsWith("Shutdown already");

    shutdown("SIGTERM");
    shutdown("SIGTERM");
    hook.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(host.exitCodes).toEqual([1]);
  });

  it("escalates to 1 when logging an ignored signal fails during the final flush", async () => {
    const { logger, host, shutdown } = setup();
    logger.flush = () => new Promise(() => {});
    logger.throwOnLog = (entry) => entry.message.startsWith("Shutdown already");

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);
    shutdown("SIGINT");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(host.exitCodes).toEqual([1]);
  });

  it("treats a failure to log completion as unsuccessful", async () => {
    const { logger, host, shutdown } = setup();
    logger.throwOnLog = (entry) => entry.message === "Graceful shutdown complete";

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    expect(host.exitCodes).toEqual([1]);
  });

  it("forces exit with 1 when the deadline expires, skipping unfinished work", async () => {
    const cleanup = vi.fn();
    const { events, logger, host, shutdown } = setup({
      onShutdownStart: () => new Promise(() => {}),
      cleanups: [cleanup],
      forceExitMs: 1_000,
    });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(999);
    expect(host.exitCodes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    const timeout = logger.find("Graceful shutdown timed out, forcing exit");
    expect(timeout).toMatchObject({ level: "error", data: signal });
    expect(timeout?.error?.message).toBe("Graceful shutdown did not complete within 1000ms");
    expect(events).not.toContain("server closed");
    expect(cleanup).not.toHaveBeenCalled();
    expect(host.exitCodes).toEqual([1]);
  });

  it("measures the deadline from the first signal", async () => {
    const { host, shutdown } = setup({
      onShutdownStart: () => new Promise(() => {}),
      forceExitMs: 1_000,
    });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(600);
    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(399);
    expect(host.exitCodes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(host.exitCodes).toEqual([1]);
  });

  it("starts no further steps when a slow step finishes after the deadline", async () => {
    const hook = Promise.withResolvers<void>();
    const cleanup = vi.fn();
    const { events, host, shutdown } = setup({
      onShutdownStart: () => hook.promise,
      cleanups: [cleanup],
      forceExitMs: 1_000,
    });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(1_000);
    hook.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(events).not.toContain("server closed");
    expect(cleanup).not.toHaveBeenCalled();
    expect(host.exitCodes).toEqual([1]);
  });

  it("stops before reporting completion when the deadline expires during a cleanup", async () => {
    let finishCleanup: () => void = () => undefined;
    const { logger, host, shutdown } = setup({
      cleanups: [() => new Promise<void>((resolve) => (finishCleanup = resolve))],
      forceExitMs: 1_000,
    });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(1_000);
    finishCleanup();
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.messages("server/shutdown")).not.toContain("Graceful shutdown complete");
    expect(host.exitCodes).toEqual([1]);
  });

  it("still forces exit when logging the timeout fails", async () => {
    const { logger, host, shutdown } = setup({
      onShutdownStart: () => new Promise(() => {}),
      forceExitMs: 10,
    });
    logger.throwOnLog = () => true;

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(10);

    expect(host.exitCodes).toEqual([1]);
  });

  it("stops starting steps and cancels the deadline once a fatal exit is selected", async () => {
    const hook = Promise.withResolvers<void>();
    const cleanup = vi.fn();
    const { events, exit, logger, host, shutdown } = setup({
      onShutdownStart: () => hook.promise,
      cleanups: [cleanup],
      forceExitMs: 1_000,
    });

    shutdown("SIGTERM");
    exit.request(1);
    hook.resolve();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(events).not.toContain("server closed");
    expect(cleanup).not.toHaveBeenCalled();
    expect(logger.messages("server/shutdown")).toEqual([
      "Received shutdown signal, closing server...",
    ]);
    expect(host.exitCodes).toEqual([1]);
  });

  it("calls the hook and cleanups as plain functions", async () => {
    const receivers: unknown[] = [];
    function record(this: unknown) {
      receivers.push(this);
    }
    const { shutdown } = setup({ onShutdownStart: record, cleanups: [record] });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    expect(receivers).toEqual([undefined, undefined]);
  });

  it("cancels the deadline when the sequence finishes", async () => {
    const { logger, host, shutdown } = setup({ forceExitMs: 1_000 });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(logger.find("Graceful shutdown timed out, forcing exit")).toBeUndefined();
    expect(host.exitCodes).toEqual([0]);
  });
});
