import { describe, expect, it } from "vitest";
import {
  isRecord,
  optionalFunction,
  optionalString,
  requireFunctionList,
  requireIntegerInRange,
  requireRecord,
} from "../../lib/config/validators.js";

describe("isRecord", () => {
  it("accepts objects and rejects null and primitives", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});

describe("requireRecord", () => {
  it("returns plain objects", () => {
    const value = { a: 1 };
    expect(requireRecord("thing", value)).toBe(value);
  });

  it.each([null, undefined, [], "x", 1])("rejects %j", (value) => {
    expect(() => requireRecord("thing", value)).toThrow(new TypeError("thing must be an object"));
  });
});

describe("requireIntegerInRange", () => {
  it("accepts integers at both bounds", () => {
    expect(requireIntegerInRange("n", 1, 1, 10)).toBe(1);
    expect(requireIntegerInRange("n", 10, 1, 10)).toBe(10);
  });

  it.each([0, 11, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5", undefined, null])(
    "rejects %j with RangeError",
    (value) => {
      expect(() => requireIntegerInRange("n", value, 1, 10)).toThrow(
        new RangeError("n must be an integer from 1 through 10"),
      );
    },
  );
});

describe("optionalString", () => {
  it("accepts strings and undefined", () => {
    expect(optionalString("s", "x")).toBe("x");
    expect(optionalString("s", undefined)).toBeUndefined();
  });

  it("rejects other values", () => {
    expect(() => optionalString("s", 1)).toThrow(new TypeError("s must be a string"));
  });
});

describe("optionalFunction", () => {
  it("accepts functions and undefined", () => {
    const fn = () => undefined;
    expect(optionalFunction("f", fn)).toBe(fn);
    expect(optionalFunction("f", undefined)).toBeUndefined();
  });

  it("rejects other values", () => {
    expect(() => optionalFunction("f", "x")).toThrow(new TypeError("f must be a function"));
  });
});

describe("requireFunctionList", () => {
  it("returns a frozen copy", () => {
    const fns = [() => 1, () => 2];
    const result = requireFunctionList("list", fns);

    expect(result).toEqual(fns);
    expect(result).not.toBe(fns);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([undefined, "x", [() => 1, "nope"]])("rejects %j", (value) => {
    expect(() => requireFunctionList("list", value)).toThrow(
      new TypeError("list must be an array of functions"),
    );
  });
});
