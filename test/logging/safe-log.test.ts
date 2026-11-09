import { describe, expect, it } from "vitest";
import { tryLogError, tryLogInfo } from "../../lib/logging/safe-log.js";
import { RecordingLogger } from "../helpers/logger.js";

describe("tryLogInfo", () => {
  it("logs and reports success", () => {
    const logger = new RecordingLogger();

    expect(tryLogInfo(logger.child("app", "test"), "hello", { a: 1 })).toBe(true);
    expect(logger.entries).toEqual([
      { scope: "app/test", level: "info", message: "hello", data: { a: 1 } },
    ]);
  });

  it("reports failure instead of throwing", () => {
    const logger = new RecordingLogger();
    logger.throwOnLog = () => true;

    expect(tryLogInfo(logger.child("app", "test"), "hello", {})).toBe(false);
  });
});

describe("tryLogError", () => {
  it("logs and reports success", () => {
    const logger = new RecordingLogger();
    const error = new Error("bad");

    expect(tryLogError(logger.child("app", "test"), "failed", error, { b: 2 })).toBe(true);
    expect(logger.entries).toEqual([
      { scope: "app/test", level: "error", message: "failed", error, data: { b: 2 } },
    ]);
  });

  it("reports failure instead of throwing", () => {
    const logger = new RecordingLogger();
    logger.throwOnLog = () => true;

    expect(tryLogError(logger.child("app", "test"), "failed", new Error("bad"), {})).toBe(false);
  });
});
