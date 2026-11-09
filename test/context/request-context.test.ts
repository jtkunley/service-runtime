import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import {
  validateContextEntries,
  validateDestinations,
} from "../../src/lib/config/validate-context.js";
import { createRequestContext } from "../../src/lib/context/request-context.js";
import type { ContextRequest, ContextSource } from "../../src/lib/context/types.js";

function setup(contextOptions: Record<string, unknown> = defaultContext, destinations?: unknown) {
  const entries = validateContextEntries(contextOptions);
  return createRequestContext(entries, validateDestinations(destinations, entries)).context;
}

const defaultContext = {
  tenant: {
    value: (request: ContextRequest) => request.headers["x-tenant"],
    required: true,
    header: "X-Tenant",
  },
  traceId: { value: (request: ContextRequest) => request.headers["x-trace-id"], header: "x-trace" },
};

const source = (tenant: string, traceId?: string): ContextSource => ({
  headers: { "x-tenant": tenant, "x-trace-id": traceId },
});

describe("context.run", () => {
  it("returns exactly what the callback returns", async () => {
    const context = setup();
    const promise = Promise.resolve("done");

    expect(context.run(source("acme"), () => 42)).toBe(42);
    expect(context.run(source("acme"), () => promise)).toBe(promise);
    await expect(promise).resolves.toBe("done");
  });

  it("preserves callback throws and rejections", async () => {
    const context = setup();
    const failure = new Error("callback failed");

    expect(() =>
      context.run(source("acme"), () => {
        throw failure;
      }),
    ).toThrow(failure);
    await expect(context.run(source("acme"), () => Promise.reject(failure))).rejects.toBe(failure);
  });

  it("exposes resolved values, including absent optional keys", () => {
    const context = setup();

    context.run(source("acme"), () => {
      expect(context.get("tenant")).toBe("acme");
      expect(context.get("traceId")).toBeUndefined();
      expect(context.getStore()).toEqual({ tenant: "acme", traceId: undefined });
      expect(Object.keys(context.getStore()!)).toEqual(["tenant", "traceId"]);
    });
  });

  it("exposes an empty store when no context is configured", () => {
    const context = setup({});

    context.run({ headers: {} }, () => {
      expect(context.getStore()).toEqual({});
    });
  });

  it("keeps the stored values immutable", () => {
    const context = setup();
    const headers: Record<string, string> = { "x-tenant": "acme" };

    context.run({ headers }, () => {
      headers["x-tenant"] = "other";
      expect(context.get("tenant")).toBe("acme");
      expect(Object.isFrozen(context.getStore())).toBe(true);
    });
  });

  it("throws before invoking the callback when required values are missing", () => {
    const context = setup({
      tenant: { value: () => undefined, required: true },
      region: { value: () => undefined, required: true },
    });
    const fn = vi.fn();

    expect(() => {
      context.run({ headers: {} }, fn);
    }).toThrow(new Error("Missing required context values: tenant, region"));
    expect(fn).not.toHaveBeenCalled();
  });

  it("propagates resolver failures without entering a partial context", () => {
    const failure = new Error("resolver failed");
    const context = setup({
      tenant: { value: () => "acme" },
      broken: {
        value: () => {
          throw failure;
        },
      },
    });
    const fn = vi.fn();

    expect(() => {
      context.run({ headers: {} }, fn);
    }).toThrow(failure);
    expect(fn).not.toHaveBeenCalled();
    expect(context.getStore()).toBeUndefined();
  });

  it.each([undefined, null, {}, { headers: null }])("requires source headers (%j)", (bad) => {
    const context = setup();

    expect(() => {
      context.run(bad as unknown as ContextSource, () => undefined);
    }).toThrow(new TypeError("context.run(source, fn) requires source.headers"));
  });

  it("passes the caller-supplied method and path to resolvers", () => {
    const value = vi.fn(() => "x");
    const context = setup({ seen: { value } });

    context.run({ headers: {}, method: "JOB", path: "/jobs/1?x=1" }, () => undefined);

    expect(value).toHaveBeenCalledWith({ headers: {}, method: "JOB", path: "/jobs/1?x=1" });
  });

  it("preserves context across awaits, timers, and promise chains", async () => {
    const context = setup();

    await context.run(source("acme"), async () => {
      await sleep(1);
      expect(context.get("tenant")).toBe("acme");

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(context.get("tenant")).toBe("acme");
          resolve();
        }, 1);
      });

      await Promise.resolve().then(() => {
        expect(context.get("tenant")).toBe("acme");
      });
    });
  });

  it("isolates concurrent executions", async () => {
    const context = setup();
    const observe = (tenant: string, wait: number) =>
      context.run(source(tenant), async () => {
        await sleep(wait);
        return context.get("tenant");
      });

    await expect(Promise.all([observe("a", 5), observe("b", 1)])).resolves.toEqual(["a", "b"]);
  });

  it("restores the outer context after a nested execution", () => {
    const context = setup();

    context.run(source("outer"), () => {
      context.run(source("inner"), () => {
        expect(context.get("tenant")).toBe("inner");
      });
      expect(context.get("tenant")).toBe("outer");
    });
  });

  it("isolates separately configured contexts", () => {
    const first = setup();
    const second = setup();

    first.run(source("acme"), () => {
      expect(second.getStore()).toBeUndefined();
    });
  });
});

describe("outside a context", () => {
  it("getStore returns undefined and get throws", () => {
    const context = setup();

    expect(context.getStore()).toBeUndefined();
    expect(() => context.get("tenant")).toThrow(new Error("No request context"));
  });

  it("get returns undefined for names that are not configured", () => {
    const context = setup();

    context.run(source("acme"), () => {
      expect(context.get("constructor")).toBeUndefined();
    });
  });
});

describe("context.getHeaders", () => {
  const destinations = { billing: ["tenant", "traceId"], audit: ["traceId"] };

  it("returns the destination's defined values under their header names", () => {
    const context = setup(defaultContext, destinations);

    context.run(source("acme"), () => {
      expect(context.getHeaders("billing")).toEqual({ "X-Tenant": "acme" });
      expect(context.getHeaders("audit")).toEqual({});
    });
    context.run(source("acme", "t-1"), () => {
      expect(context.getHeaders("billing")).toEqual({ "X-Tenant": "acme", "x-trace": "t-1" });
    });
  });

  it("returns an empty object outside a context", () => {
    expect(setup(defaultContext, destinations).getHeaders("billing")).toEqual({});
  });

  it("uses the destination named default when no name is given", () => {
    const context = setup(defaultContext, { default: ["traceId"], billing: ["tenant"] });

    context.run(source("acme", "t-1"), () => {
      expect(context.getHeaders()).toEqual({ "x-trace": "t-1" });
      expect(context.getHeaders("default")).toEqual({ "x-trace": "t-1" });
    });
  });

  it("throws when no name is given and no default destination is declared", () => {
    const context = setup(defaultContext, destinations);

    expect(() => context.getHeaders()).toThrow(new Error("Unknown destination: default"));
  });

  it.each(["payments", "toString"])("throws for undeclared destination %s", (name) => {
    const context = setup(defaultContext, destinations);

    expect(() => context.getHeaders(name)).toThrow(new Error(`Unknown destination: ${name}`));
  });

  it("returns a fresh object that callers can mutate safely", () => {
    const context = setup(defaultContext, destinations);

    context.run(source("acme"), () => {
      const headers = context.getHeaders("billing");
      headers["X-Tenant"] = "changed";

      expect(context.getHeaders("billing")).toEqual({ "X-Tenant": "acme" });
      expect(context.get("tenant")).toBe("acme");
    });
  });

  it("throws a TypeError for values that are not valid header values", () => {
    const context = setup(
      { tenant: { value: () => "acme\u2603", header: "x-tenant" } },
      { billing: ["tenant"] },
    );

    context.run({ headers: {} }, () => {
      expect(() => context.getHeaders("billing")).toThrow(TypeError);
    });
  });
});
