import { describe, expect, it, vi } from "vitest";
import { ExitCoordinator } from "../../lib/lifecycle/exit-coordinator.js";
import { createFatalErrorHandlers } from "../../lib/lifecycle/fatal-errors.js";
import { FakeHost } from "../helpers/host.js";
import { RecordingLogger } from "../helpers/logger.js";

function setup() {
  const logger = new RecordingLogger();
  const host = new FakeHost();
  const markShuttingDown = vi.fn();
  const handlers = createFatalErrorHandlers({
    log: logger.child("server", "fatal"),
    exit: new ExitCoordinator(logger, host),
    markShuttingDown,
  });
  return { logger, host, markShuttingDown, handlers };
}

describe("fatal error handlers", () => {
  it("logs uncaught exceptions with the original error and exits with 1", () => {
    const { logger, host, markShuttingDown, handlers } = setup();
    const failure = new Error("boom");

    handlers.uncaughtException(failure);

    expect(markShuttingDown).toHaveBeenCalledOnce();
    expect(logger.entries).toEqual([
      {
        scope: "server/fatal",
        level: "error",
        message: "Uncaught exception, exiting",
        error: failure,
        data: {},
      },
    ]);
    expect(host.exitCodes).toEqual([1]);
  });

  it("wraps non-error rejection reasons", () => {
    const { logger, handlers } = setup();

    handlers.unhandledRejection("nope");

    const entry = logger.find("Unhandled promise rejection, exiting");
    expect(entry?.error?.message).toBe("nope");
    expect(entry?.error?.cause).toBe("nope");
  });

  it("still exits when the reason cannot be converted to a string", () => {
    const { logger, host, handlers } = setup();

    handlers.unhandledRejection(Object.create(null));

    expect(logger.entries[0]?.error?.message).toMatch(/could not be converted/);
    expect(host.exitCodes).toEqual([1]);
  });

  it("continues toward exit when logging fails", () => {
    const { logger, host, handlers } = setup();
    logger.throwOnLog = () => true;

    handlers.uncaughtException(new Error("boom"));

    expect(host.exitCodes).toEqual([1]);
  });

  it("reports additional fatal events without starting another exit", () => {
    const { logger, host, handlers } = setup();

    handlers.uncaughtException(new Error("first"));
    handlers.unhandledRejection(new Error("second"));

    expect(logger.entries).toHaveLength(2);
    expect(host.exitCodes).toEqual([1]);
  });
});
