import express from "express";
import { Agent } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContextRequest } from "../../lib/context/types.js";
import { releaseListen } from "../../lib/lifecycle/listen-reservation.js";
import { createService } from "../../lib/service/create-service.js";
import { delay, makeConfig } from "../helpers/config.js";
import { FakeHost } from "../helpers/host.js";
import { request } from "../helpers/http.js";
import { RecordingLogger } from "../helpers/logger.js";

afterEach(() => {
  releaseListen();
});

describe("createService", () => {
  it("obtains the context logger without touching the host process", () => {
    const logger = new RecordingLogger();
    const host = new FakeHost();
    const on = vi.spyOn(host, "on");

    const service = createService(makeConfig({ logger }), host);

    expect(logger.childCalls).toEqual(["server/context"]);
    expect(on).not.toHaveBeenCalled();
    expect(service.isShuttingDown()).toBe(false);
    expect(Object.isFrozen(service)).toBe(true);
  });

  it("fails configuration when the context logger cannot be created", () => {
    const logger = new RecordingLogger();
    logger.failingChildren.add("server/context");

    expect(() => createService(makeConfig({ logger }), new FakeHost())).toThrow(
      "Logger child server/context unavailable",
    );
  });

  it("drains in-flight requests in context, then cleans up and exits with 0", async () => {
    const events: string[] = [];
    const hook = Promise.withResolvers<void>();
    const requestEntered = Promise.withResolvers<void>();
    const requestRelease = Promise.withResolvers<void>();
    const host = new FakeHost();
    const agent = new Agent({ keepAlive: true });

    const service = createService(
      makeConfig({
        context: {
          tenant: {
            value: (req: ContextRequest) => req.headers["x-tenant"],
            required: true,
          },
        },
        onShutdownStart: async () => {
          events.push("hook started");
          await hook.promise;
          events.push("hook finished");
        },
        cleanups: [
          function closeQueue() {
            events.push("cleanup");
          },
        ],
      }),
      host,
    );

    const app = express();
    app.use(service.middleware);
    app.get("/slow", async (_req, res) => {
      requestEntered.resolve();
      await requestRelease.promise;
      res.json({ tenant: service.context.get("tenant") });
    });
    const address = await service.listen(app);

    const inFlight = request(address, {
      path: "/slow",
      headers: { "x-tenant": "acme" },
      agent,
    });
    await requestEntered.promise;

    host.emit("SIGTERM", "SIGTERM");
    expect(service.isShuttingDown()).toBe(true);
    expect((await request(address, { path: "/readiness" })).status).toBe(503);
    expect((await request(address, { path: "/liveness" })).status).toBe(200);
    expect(events).toEqual(["hook started"]);

    hook.resolve();
    await delay(20);
    expect(events).toEqual(["hook started", "hook finished"]);

    requestRelease.resolve();
    const response = await inFlight;
    const respondedAt = Date.now();
    expect(JSON.parse(response.body)).toEqual({ tenant: "acme" });

    await expect(host.exited).resolves.toBe(0);
    expect(Date.now() - respondedAt).toBeLessThan(2_000);
    expect(events).toEqual(["hook started", "hook finished", "cleanup"]);
    agent.destroy();
  });
});
