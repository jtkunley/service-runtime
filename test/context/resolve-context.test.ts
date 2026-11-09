import { describe, expect, it, vi } from "vitest";
import { validateContextEntries } from "../../src/lib/config/validate-context.js";
import { missingContextMessage, resolveContext } from "../../src/lib/context/resolve-context.js";
import type { ContextRequest } from "../../src/lib/context/types.js";

describe("resolveContext", () => {
  it("gives resolvers lower-cased headers, joined repeats, method, and path", () => {
    const seen: ContextRequest[] = [];
    const entries = validateContextEntries({
      probe: {
        value: (request: ContextRequest) => {
          seen.push(request);
          return undefined;
        },
      },
    });

    resolveContext(entries, {
      headers: { "X-Tenant": "acme", "x-forwarded-for": ["a", "b"], "X-Empty": undefined },
      method: "POST",
      path: "/orders",
    });

    expect(seen).toEqual([
      {
        headers: { "x-tenant": "acme", "x-forwarded-for": "a, b" },
        method: "POST",
        path: "/orders",
      },
    ]);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(Object.isFrozen(seen[0]!.headers)).toBe(true);
  });

  it("joins header names that differ only by case", () => {
    const value = vi.fn((request: ContextRequest) => request.headers["x-id"]);
    const entries = validateContextEntries({ id: { value } });

    const { store } = resolveContext(entries, { headers: { "X-Id": "1", "x-id": ["2", "3"] } });

    expect(store).toEqual({ id: "1, 2, 3" });
  });

  it("preserves a __proto__ header as an ordinary property", () => {
    const entries = validateContextEntries({
      proto: { value: (request: ContextRequest) => request.headers.__proto__ },
    });
    const headers = JSON.parse('{"__proto__": "value"}') as Record<string, string>;

    expect(resolveContext(entries, { headers }).store).toEqual({ proto: "value" });
  });

  it("trims values and treats blank, undefined, and null results as absent", () => {
    const entries = validateContextEntries({
      padded: { value: () => "  acme  " },
      empty: { value: () => "" },
      blank: { value: () => " \t " },
      missing: { value: () => undefined },
      nothing: { value: () => null as unknown as string },
    });

    const { store, missing } = resolveContext(entries, { headers: {} });

    expect(store).toEqual({
      padded: "acme",
      empty: undefined,
      blank: undefined,
      missing: undefined,
      nothing: undefined,
    });
    expect(Object.keys(store)).toEqual(["padded", "empty", "blank", "missing", "nothing"]);
    expect(Object.isFrozen(store)).toBe(true);
    expect(missing).toEqual([]);
  });

  it("calls each resolver exactly once", () => {
    const value = vi.fn(() => "x");
    resolveContext(validateContextEntries({ a: { value, required: true } }), { headers: {} });

    expect(value).toHaveBeenCalledTimes(1);
  });

  it("reports missing required entries in configuration order", () => {
    const entries = validateContextEntries({
      tenant: { value: () => undefined, required: true },
      present: { value: () => "x", required: true },
      region: { value: () => " ", required: true },
      optional: { value: () => undefined },
    });

    expect(resolveContext(entries, { headers: {} }).missing).toEqual(["tenant", "region"]);
  });

  it("rejects resolver results that are not strings", () => {
    const entries = validateContextEntries({ tenant: { value: () => 42 as unknown as string } });

    expect(() => resolveContext(entries, { headers: {} })).toThrow(
      new TypeError('Context entry "tenant" must resolve to a string or undefined'),
    );
  });

  it("does not await asynchronous resolvers", () => {
    const entries = validateContextEntries({
      tenant: { value: () => Promise.resolve("acme") as unknown as string },
    });

    expect(() => resolveContext(entries, { headers: {} })).toThrow(
      new TypeError('Context entry "tenant" must resolve to a string or undefined'),
    );
  });

  it("keeps a rejected promise from a resolver from becoming an unhandled rejection", async () => {
    const entries = validateContextEntries({
      tenant: { value: () => Promise.reject(new Error("late")) as unknown as string },
    });

    expect(() => resolveContext(entries, { headers: {} })).toThrow(TypeError);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("gives resolvers headers without inherited properties", () => {
    const entries = validateContextEntries({
      inherited: { value: (request: ContextRequest) => request.headers.constructor },
    });

    expect(resolveContext(entries, { headers: {} }).store).toEqual({ inherited: undefined });
  });

  it("propagates resolver exceptions", () => {
    const failure = new Error("resolver failed");
    const entries = validateContextEntries({
      tenant: {
        value: () => {
          throw failure;
        },
      },
    });

    expect(() => resolveContext(entries, { headers: {} })).toThrow(failure);
  });
});

describe("missingContextMessage", () => {
  it("formats one missing value", () => {
    expect(missingContextMessage(["tenant"])).toBe("Missing required context value: tenant");
  });

  it("formats several missing values", () => {
    expect(missingContextMessage(["tenant", "region"])).toBe(
      "Missing required context values: tenant, region",
    );
  });
});
