import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExitCoordinator } from "../../lib/lifecycle/exit-coordinator.js";
import { FakeHost } from "../helpers/host.js";
import { RecordingLogger } from "../helpers/logger.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(flush?: () => Promise<void>) {
  const logger = new RecordingLogger();
  if (flush) logger.flush = flush;
  const host = new FakeHost();
  return { logger, host, exit: new ExitCoordinator(logger, host) };
}

describe("ExitCoordinator", () => {
  it("exits immediately when the logger has no flush method", () => {
    const { host, exit } = setup();

    expect(exit.requested).toBe(false);
    exit.request(0);

    expect(exit.requested).toBe(true);
    expect(host.exitCodes).toEqual([0]);
  });

  it("flushes the root logger before exiting", async () => {
    const exitCodesDuringFlush: number[][] = [];
    const { host, exit } = setup(() => {
      exitCodesDuringFlush.push([...host.exitCodes]);
      return Promise.resolve();
    });

    exit.request(1);
    expect(host.exitCodes).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);

    expect(exitCodesDuringFlush).toEqual([[]]);
    expect(host.exitCodes).toEqual([1]);
  });

  it("calls flush with the logger as this", async () => {
    const flush = vi.fn(() => Promise.resolve());
    const { logger, exit } = setup(flush);

    exit.request(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(flush.mock.contexts).toEqual([logger]);
  });

  it("waits at most one second for a hanging flush", async () => {
    const { host, exit } = setup(() => new Promise(() => undefined));

    exit.request(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(host.exitCodes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(host.exitCodes).toEqual([0]);
  });

  it.each([
    ["rejects", () => Promise.reject(new Error("flush failed"))],
    [
      "throws",
      () => {
        throw new Error("flush failed");
      },
    ],
  ])("exits with the selected code when flush %s", async (_label, flush) => {
    const { host, exit } = setup(flush);

    exit.request(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(host.exitCodes).toEqual([1]);
  });

  it("escalates from 0 to 1 while flushing and never downgrades", async () => {
    const { host, exit } = setup(() => new Promise(() => undefined));

    exit.request(0);
    exit.request(1);
    exit.request(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(host.exitCodes).toEqual([1]);
  });

  it("flushes once and does not extend the flush deadline", async () => {
    const flush = vi.fn(() => new Promise<void>(() => undefined));
    const { host, exit } = setup(flush);

    exit.request(0);
    await vi.advanceTimersByTimeAsync(900);
    exit.request(1);
    await vi.advanceTimersByTimeAsync(100);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(host.exitCodes).toEqual([1]);
  });
});
