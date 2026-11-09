import express, { type ErrorRequestHandler } from "express";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestContext } from "../../src/lib/context/request-context.js";
import type { ContextRequest } from "../../src/lib/context/types.js";
import { createContextMiddleware, type MiddlewareRequest } from "../../src/lib/http/middleware.js";
import { makeConfig } from "../helpers/config.js";
import { request } from "../helpers/http.js";
import { RecordingLogger } from "../helpers/logger.js";

function setup(contextOptions: Record<string, unknown>) {
  const logger = new RecordingLogger();
  const requestContext = createRequestContext(makeConfig({ context: contextOptions }));
  const middleware = createContextMiddleware(requestContext, logger.child("server", "context"));
  return { logger, context: requestContext.context, middleware };
}

const tenantContext = {
  tenant: {
    value: (request: ContextRequest) => request.headers["x-tenant"],
    required: true,
  },
};

class FakeResponse {
  statusCode = 200;
  readonly headers: Record<string, string> = {};
  body: string | undefined;

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  end(body?: string): void {
    this.body = body;
  }
}

function fakeRequest(fields: Partial<MiddlewareRequest>): MiddlewareRequest {
  return { headers: {}, method: "GET", ...fields } as MiddlewareRequest;
}

function invoke(middleware: ReturnType<typeof setup>["middleware"], req: MiddlewareRequest) {
  const response = new FakeResponse();
  const next = vi.fn();
  middleware(req, response as unknown as ServerResponse, next);
  return { response, next };
}

describe("context middleware", () => {
  it("runs downstream work inside the resolved context", () => {
    const { context, middleware } = setup(tenantContext);
    let seen: string | undefined;
    const response = new FakeResponse();

    middleware(
      fakeRequest({ headers: { "x-tenant": "acme" }, url: "/" }),
      response as unknown as ServerResponse,
      (error) => {
        expect(error).toBeUndefined();
        seen = context.get("tenant");
      },
    );

    expect(seen).toBe("acme");
  });

  it("gives resolvers the original path without its query string", () => {
    const seen: ContextRequest[] = [];
    const { middleware } = setup({
      seen: {
        value: (req: ContextRequest) => {
          seen.push(req);
          return undefined;
        },
      },
    });

    invoke(middleware, fakeRequest({ url: "/orders?page=2", method: "POST" }));
    invoke(middleware, fakeRequest({ url: "/inner", originalUrl: "/api/inner?x=1" }));
    invoke(middleware, fakeRequest({}));

    expect(seen.map((req) => req.path)).toEqual(["/orders", "/api/inner", "/"]);
    expect(seen[0]?.method).toBe("POST");
  });

  it("rejects missing required context with a 400 JSON response", () => {
    const { middleware, logger } = setup({
      ...tenantContext,
      region: { value: () => undefined, required: true },
    });

    const { response, next } = invoke(
      middleware,
      fakeRequest({
        url: "/orders?secret=1",
        method: "PUT",
        headers: { authorization: "Bearer secret" },
      }),
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(response.body!)).toEqual({
      error: "Missing required context values: tenant, region",
    });
    expect(logger.entries).toEqual([
      {
        scope: "server/context",
        level: "error",
        message: "Missing required context values: tenant, region",
        error: new Error("Missing required context values: tenant, region"),
        data: { method: "PUT", path: "/orders", missing: ["tenant", "region"] },
      },
    ]);
  });

  it("excludes headers, query strings, and resolved values from rejection logs", () => {
    const { middleware, logger } = setup({
      present: { value: () => "resolved-secret" },
      ...tenantContext,
    });

    invoke(middleware, fakeRequest({ url: "/x?token=abc", headers: { cookie: "session=1" } }));

    const logged = JSON.stringify(logger.entries[0]?.data);
    expect(logged).not.toMatch(/token|abc|session|resolved-secret/);
  });

  it("does not log when context is valid", () => {
    const { middleware, logger } = setup(tenantContext);

    invoke(middleware, fakeRequest({ url: "/", headers: { "x-tenant": "acme" } }));

    expect(logger.entries).toEqual([]);
  });

  it("still responds 400 when the logger throws", () => {
    const { middleware, logger } = setup(tenantContext);
    logger.throwOnLog = () => true;

    const { response, next } = invoke(middleware, fakeRequest({ url: "/" }));

    expect(response.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes resolver failures to next without running downstream work in context", () => {
    const failure = new Error("resolver failed");
    const { middleware, logger } = setup({
      broken: {
        value: () => {
          throw failure;
        },
      },
    });

    const { response, next } = invoke(middleware, fakeRequest({ url: "/" }));

    expect(next).toHaveBeenCalledExactlyOnceWith(failure);
    expect(response.body).toBeUndefined();
    expect(logger.entries).toEqual([]);
  });
});

describe("context middleware with Express", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const current = server;
    server = undefined;
    if (current) await new Promise((resolve) => current.close(resolve));
  });

  async function serve(app: express.Express): Promise<AddressInfo> {
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return server.address() as AddressInfo;
  }

  it("preserves context through mounted routers, body parsing, and async routes", async () => {
    const paths: (string | undefined)[] = [];
    const { context, middleware } = setup({
      ...tenantContext,
      path: {
        value: (request: ContextRequest) => {
          paths.push(request.path);
          return request.path;
        },
      },
    });

    const router = express.Router();
    router.use(middleware);
    router.use(express.json());
    router.post("/orders/:id", async (req, res) => {
      await sleep(5);
      res.json({ tenant: context.get("tenant"), body: req.body as unknown });
    });

    const app = express();
    app.use("/api", router);
    const address = await serve(app);

    const result = await request(address, {
      method: "POST",
      path: "/api/orders/7?draft=true",
      headers: { "x-tenant": "acme", "content-type": "application/json" },
      body: JSON.stringify({ qty: 2 }),
    });

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ tenant: "acme", body: { qty: 2 } });
    expect(paths).toEqual(["/api/orders/7"]);
  });

  it("lets resolver failures reach Express error handling", async () => {
    const route = vi.fn();
    const { middleware } = setup({
      broken: {
        value: () => {
          throw new Error("resolver failed");
        },
      },
    });
    const errorHandler: ErrorRequestHandler = (error: Error, _req, res, _next) => {
      res.status(500).json({ handled: error.message });
    };

    const app = express();
    app.use(middleware);
    app.get("/", route);
    app.use(errorHandler);
    const address = await serve(app);

    const result = await request(address);

    expect(result.status).toBe(500);
    expect(JSON.parse(result.body)).toEqual({ handled: "resolver failed" });
    expect(route).not.toHaveBeenCalled();
  });

  it("rejects missing context before routes run", async () => {
    const route = vi.fn();
    const { middleware } = setup(tenantContext);
    const app = express();
    app.use(middleware);
    app.get("/", route);
    const address = await serve(app);

    const result = await request(address);

    expect(result.status).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ error: "Missing required context value: tenant" });
    expect(route).not.toHaveBeenCalled();
  });
});

export type { IncomingMessage };
