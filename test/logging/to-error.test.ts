import { describe, expect, it } from "vitest";
import { toError } from "../../lib/logging/to-error.js";

describe("toError", () => {
  it("returns existing errors unchanged", () => {
    const error = new RangeError("out of range");
    expect(toError(error)).toBe(error);
  });

  it.each([
    ["a string", "boom", "boom"],
    ["a number", 42, "42"],
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["a symbol", Symbol("failure"), "Symbol(failure)"],
    ["an object with toString", { toString: () => "custom failure" }, "custom failure"],
  ])("wraps %s using String(value) and keeps it as cause", (_label, value, message) => {
    const error = toError(value);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(message);
    expect(error.cause).toBe(value);
  });

  it("falls back to a safe message when the value cannot be converted to a string", () => {
    const value: unknown = Object.create(null);
    const error = toError(value);

    expect(error.message).toBe("Non-error failure value could not be converted to a string");
    expect(error.cause).toBe(value);
  });

  it("never throws, even for a revoked proxy", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    const error = toError(proxy);

    expect(error.message).toBe("Non-error failure value could not be converted to a string");
    expect(error.cause).toBe(proxy);
  });
});
