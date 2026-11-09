import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import {
  validateContextEntries,
  validateDestinations,
} from "../../src/lib/config/validate-context.js";
import { createRequestContext } from "../../src/lib/context/request-context.js";
import type { ContextRequest, ContextSource } from "../../src/lib/context/types.js";

function setupRequestContext(
  contextOptions: Record<string, unknown> = defaultContext,
  destinations?: unknown,
) {
  const entries = validateContextEntries(contextOptions);
  return createRequestContext(entries, validateDestinations(destinations, entries));
}

function setup(contextOptions: Record<string, unknown> = defaultContext, destinations?: unknown) {
  return setupRequestContext(contextOptions, destinations).context;
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

  it("combines the headers of several destinations", () => {
    const context = setup(defaultContext, { tenantOnly: ["tenant"], audit: ["traceId"] });

    context.run(source("acme", "t-1"), () => {
      expect(context.getHeaders(["tenantOnly", "audit"])).toEqual({
        "X-Tenant": "acme",
        "x-trace": "t-1",
      });
      expect(context.getHeaders(["tenantOnly", "tenantOnly"])).toEqual({ "X-Tenant": "acme" });
      expect(context.getHeaders([])).toEqual({});
    });
  });

  it("throws if any destination in a list is undeclared", () => {
    const context = setup(defaultContext, destinations);

    expect(() => context.getHeaders(["billing", "payments"])).toThrow(
      new Error("Unknown destination: payments"),
    );
  });

  it("throws if combined destinations send different entries under one header", () => {
    const context = setup(
      { ...defaultContext, alias: { value: () => "other", header: "x-tenant" } },
      { billing: ["tenant"], partner: ["alias"] },
    );

    expect(() => context.getHeaders(["billing", "partner"])).toThrow(
      new Error(
        'Destinations "billing" and "partner" map context entries "tenant" and "alias" to header "x-tenant"',
      ),
    );
  });

  it("forwards every entry with a header when no destinations are declared", () => {
    const context = setup({ ...defaultContext, local: { value: () => "kept-local" } });

    context.run(source("acme", "t-1"), () => {
      expect(context.getHeaders()).toEqual({ "X-Tenant": "acme", "x-trace": "t-1" });
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

describe("createFetch", () => {
  const destinations = { default: ["tenant"], audit: ["traceId"] };

  async function withEchoServer(run: (url: string) => Promise<void>): Promise<IncomingHttpHeaders> {
    let received: IncomingHttpHeaders = {};
    const server = createServer((req, res) => {
      received = req.headers;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://127.0.0.1:${port}/`);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    return received;
  }

  it("sends the default destination's headers through Node's fetch", async () => {
    const { context, createFetch } = setupRequestContext(defaultContext, destinations);
    const contextFetch = createFetch();

    const received = await withEchoServer((url) =>
      context.run(source("acme", "t-1"), async () => {
        await (await contextFetch(url)).text();
      }),
    );

    expect(received["x-tenant"]).toBe("acme");
    expect(received["x-trace"]).toBeUndefined();
  });

  it("sends the headers of a named or combined destination", async () => {
    const { context, createFetch } = setupRequestContext(defaultContext, destinations);
    const auditFetch = createFetch("audit");
    const combinedFetch = createFetch(["default", "audit"]);

    const audit = await withEchoServer((url) =>
      context.run(source("acme", "t-1"), async () => {
        await (await auditFetch(url)).text();
      }),
    );
    const combined = await withEchoServer((url) =>
      context.run(source("acme", "t-1"), async () => {
        await (await combinedFetch(url)).text();
      }),
    );

    expect([audit["x-tenant"], audit["x-trace"]]).toEqual([undefined, "t-1"]);
    expect([combined["x-tenant"], combined["x-trace"]]).toEqual(["acme", "t-1"]);
  });

  it("sends no context headers outside a context", async () => {
    const contextFetch = setupRequestContext(defaultContext, destinations).createFetch();

    const received = await withEchoServer(async (url) => {
      await (await contextFetch(url)).text();
    });

    expect(received["x-tenant"]).toBeUndefined();
  });

  it("rejects unknown destinations when the fetch is created", () => {
    const { createFetch } = setupRequestContext(defaultContext, { audit: ["traceId"] });

    expect(() => createFetch()).toThrow(new Error("Unknown destination: default"));
    expect(() => createFetch(["audit", "payments"])).toThrow(
      new Error("Unknown destination: payments"),
    );
  });
});
