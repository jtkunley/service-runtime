import express from "express";
import type { AddressInfo } from "node:net";
import { describe, expectTypeOf, it } from "vitest";
import { configureService, type Logger, type Service } from "../../src/index.js";

declare const logger: Logger;

describe("configureService types", () => {
  it("types required entries as string and optional entries as string | undefined", () => {
    const service = configureService({
      logger,
      port: 0,
      context: {
        tenant: { value: (request) => request.headers["x-tenant"], required: true },
        traceId: { value: (request) => request.headers["x-trace-id"] },
        flag: { value: () => undefined, required: false },
      },
    });

    expectTypeOf(service.context.get("tenant")).toEqualTypeOf<string>();
    expectTypeOf(service.context.get("traceId")).toEqualTypeOf<string | undefined>();
    expectTypeOf(service.context.get("flag")).toEqualTypeOf<string | undefined>();
    expectTypeOf(service.context.getStore()).toEqualTypeOf<
      | {
          readonly tenant: string;
          readonly traceId: string | undefined;
          readonly flag: string | undefined;
        }
      | undefined
    >();
  });

  it("supplies resolvers with the typed request", () => {
    configureService({
      logger,
      port: 0,
      context: {
        tenant: {
          value(request) {
            expectTypeOf(request.headers).toEqualTypeOf<
              Readonly<Partial<Record<string, string>>>
            >();
            expectTypeOf(request.headers["x-tenant"]).toEqualTypeOf<string | undefined>();
            expectTypeOf(request.method).toEqualTypeOf<string | undefined>();
            expectTypeOf(request.path).toEqualTypeOf<string | undefined>();
            return undefined;
          },
        },
      },
    });
  });

  it("rejects unknown context keys", () => {
    const service = configureService({
      logger,
      port: 0,
      context: { tenant: { value: () => "acme" } },
    });

    // @ts-expect-error unknown context key
    service.context.get("region");
  });

  it("rejects unknown entry attributes", () => {
    configureService({
      logger,
      port: 0,
      context: {
        // @ts-expect-error `fallback` is not a context entry attribute
        tenant: { value: () => "acme", fallback: "default" },
      },
    });
  });

  it("restricts destination names and the entries they list", () => {
    const service = configureService({
      logger,
      port: 0,
      context: {
        tenant: { value: () => "acme", header: "x-tenant" },
        traceId: { value: () => undefined, header: "x-trace-id" },
      },
      destinations: { billing: ["tenant"], audit: ["tenant", "traceId"] },
    });

    expectTypeOf<Parameters<typeof service.context.getHeaders>[0]>().toEqualTypeOf<
      "billing" | "audit"
    >();
    expectTypeOf(service.context.getHeaders("billing")).toEqualTypeOf<Record<string, string>>();

    // @ts-expect-error unknown destination
    service.context.getHeaders("payments");
    // @ts-expect-error a name is required without a default destination
    service.context.getHeaders();

    configureService({
      logger,
      port: 0,
      context: { tenant: { value: () => "acme", header: "x-tenant" } },
      // @ts-expect-error destination lists an unknown entry
      destinations: { billing: ["region"] },
    });
  });

  it("allows omitting the name when a default destination is declared", () => {
    const service = configureService({
      logger,
      port: 0,
      context: { tenant: { value: () => "acme", header: "x-tenant" } },
      destinations: { default: ["tenant"], billing: ["tenant"] },
    });

    expectTypeOf(service.context.getHeaders()).toEqualTypeOf<Record<string, string>>();
    expectTypeOf(service.context.getHeaders("billing")).toEqualTypeOf<Record<string, string>>();
  });

  it("declares no destinations when only context is configured", () => {
    const service = configureService({
      logger,
      port: 0,
      context: { tenant: { value: () => "acme", header: "x-tenant" } },
    });

    expectTypeOf(service.context.getHeaders.bind(service.context))
      .parameter(0)
      .toEqualTypeOf<never>();
  });

  it("exposes an empty store and no destinations without context configuration", () => {
    const service = configureService({ logger, port: 0 });

    expectTypeOf(service).toEqualTypeOf<Service>();
    expectTypeOf<Parameters<typeof service.context.getHeaders>[0]>().toEqualTypeOf<never>();
    // @ts-expect-error no context keys are configured
    service.context.get("tenant");
  });

  it("returns exactly what the scoped callback returns", () => {
    const service = configureService({ logger, port: 0 });

    expectTypeOf(service.context.run({ headers: {} }, () => 42)).toEqualTypeOf<number>();
    expectTypeOf(service.context.run({ headers: {} }, () => Promise.resolve("done"))).toEqualTypeOf<
      Promise<string>
    >();
  });

  it("works with Express applications and middleware", () => {
    const service = configureService({ logger, port: 0 });
    const app = express();

    app.use(service.middleware);
    expectTypeOf(service.listen(app)).toEqualTypeOf<Promise<AddressInfo>>();
  });

  it("requires a logger and port", () => {
    // @ts-expect-error port is required
    configureService({ logger });
    // @ts-expect-error logger is required
    configureService({ port: 0 });
  });

  it("accepts every optional setting", () => {
    configureService({
      logger,
      port: 3000,
      host: "127.0.0.1",
      probes: { readiness: "/ready", liveness: false },
      cleanups: [() => undefined, () => Promise.resolve(1)],
      keepAliveTimeoutMs: 10_000,
      shutdownSignals: ["SIGTERM", "SIGUSR2"],
      forceExitMs: 5_000,
      onShutdownStart: () => Promise.resolve(),
    });
  });
});
