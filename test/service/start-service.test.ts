import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releaseListen } from "../../lib/lifecycle/listen-reservation.js";
import { startService, type ShutdownState } from "../../lib/service/start-service.js";
import { makeConfig } from "../helpers/config.js";
import { FakeHost } from "../helpers/host.js";
import { request } from "../helpers/http.js";
import { RecordingLogger } from "../helpers/logger.js";

const servers = vi.hoisted(() => [] as Server[]);

vi.mock("../../lib/http/http-server.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/http/http-server.js")>();
  return {
    ...original,
    createHttpServer: (...args: Parameters<typeof original.createHttpServer>) => {
      const server = original.createHttpServer(...args);
      servers.push(server);
      return server;
    },
  };
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  releaseListen();
});

function shutdownState(): ShutdownState {
  let shuttingDown = false;
  return {
    isShuttingDown: () => shuttingDown,
    markShuttingDown: () => {
      shuttingDown = true;
    },
  };
}

async function occupyPort(hostname: string): Promise<number> {
  const occupant = createServer();
  servers.push(occupant);
  const address = await new Promise<AddressInfo>((resolve) => {
    occupant.listen(0, hostname, () => {
      resolve(occupant.address() as AddressInfo);
    });
  });
  return address.port;
}

const respondOk: RequestListener = (_req, res) => {
  res.end("app");
};

function start(overrides: Record<string, unknown> = {}, app: RequestListener = respondOk) {
  const logger = new RecordingLogger();
  const host = new FakeHost();
  const state = shutdownState();
  const config = makeConfig({ logger, ...overrides });
  const started = startService({ config, app, host, state });
  return { logger, host, state, started };
}

describe("startService", () => {
  it("serves the application on the actual bound address", async () => {
    const app = vi.fn(respondOk);
    const { started } = start({}, app);
    const address = await started;

    expect(address).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
    expect(address.port).toBeGreaterThan(0);
    await expect(request(address, { path: "/orders" })).resolves.toMatchObject({
      status: 200,
      body: "app",
    });
    expect(app).toHaveBeenCalledOnce();
  });

  it("answers probes before the application with empty bodies", async () => {
    const app = vi.fn(respondOk);
    const address = await start({}, app).started;

    const results = await Promise.all([
      request(address, { path: "/readiness" }),
      request(address, { path: "/liveness?full=1" }),
      request(address, { path: "/readiness", method: "HEAD" }),
    ]);

    expect(results.map(({ status, body }) => [status, body])).toEqual([
      [200, ""],
      [200, ""],
      [200, ""],
    ]);
    expect(app).not.toHaveBeenCalled();
  });

  it("passes other methods, disabled probes, and unrelated paths to the application", async () => {
    const app = vi.fn(respondOk);
    const address = await start({ probes: { readiness: "/ready", liveness: false } }, app).started;

    await request(address, { path: "/ready", method: "POST" });
    await request(address, { path: "/liveness" });
    await request(address, { path: "/readiness" });
    expect((await request(address, { path: "/ready" })).body).toBe("");

    expect(app).toHaveBeenCalledTimes(3);
  });

  it("installs fatal handlers and each configured signal once", async () => {
    const { host, started } = start({ shutdownSignals: ["SIGTERM", "SIGUSR2", "SIGTERM"] });
    await started;

    expect(host.eventNames().sort()).toEqual(
      ["SIGTERM", "SIGUSR2", "uncaughtException", "unhandledRejection"].sort(),
    );
    expect(host.listenerCount("SIGTERM")).toBe(1);
  });

  it("starts graceful shutdown when a configured signal arrives", async () => {
    const { host, state, started } = start();
    await started;

    host.emit("SIGINT", "SIGINT");

    expect(state.isShuttingDown()).toBe(true);
    await expect(host.exited).resolves.toBe(0);
  });

  it("fails readiness and exits with 1 on fatal errors without graceful cleanup", async () => {
    const cleanup = vi.fn();
    const { host, state, logger, started } = start({ cleanups: [cleanup] });
    const address = await started;

    host.emit("unhandledRejection", new Error("lost promise"));

    expect(state.isShuttingDown()).toBe(true);
    expect(logger.messages("server/fatal")).toEqual(["Unhandled promise rejection, exiting"]);
    expect(host.exitCodes).toEqual([1]);
    expect((await request(address, { path: "/readiness" })).status).toBe(503);
    expect((await request(address, { path: "/liveness" })).status).toBe(200);

    host.emit("SIGTERM", "SIGTERM");
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("rejects repeated and competing listen attempts", async () => {
    const first = start();
    const competing = start();

    await expect(first.started).resolves.toBeDefined();
    await expect(competing.started).rejects.toThrow("Only one service can listen per process");
    await expect(start().started).rejects.toThrow("Only one service can listen per process");
    expect(competing.host.eventNames()).toEqual([]);
  });

  it("rejects a non-function app without reserving the process", async () => {
    const invalid = start({}, "app" as unknown as RequestListener);

    await expect(invalid.started).rejects.toThrow(
      new TypeError("listen(app) requires a request listener"),
    );
    await expect(start().started).resolves.toBeDefined();
  });

  it.each(["server/shutdown", "server/fatal"])(
    "rejects startup when the %s logger cannot be created",
    async (scope) => {
      const logger = new RecordingLogger();
      logger.failingChildren.add(scope);
      const host = new FakeHost();

      await expect(
        startService({
          config: makeConfig({ logger }),
          app: respondOk,
          host,
          state: shutdownState(),
        }),
      ).rejects.toThrow(`Logger child ${scope} unavailable`);
      expect(host.eventNames()).toEqual([]);
      expect(servers).toEqual([]);
      await expect(start().started).resolves.toBeDefined();
    },
  );

  it("finishes binding before closing when a signal arrives during startup", async () => {
    const { host, started } = start({ host: "localhost" });

    host.emit("SIGTERM", "SIGTERM");

    await expect(started).resolves.toBeDefined();
    await expect(host.exited).resolves.toBe(0);
  });

  it("keeps shutdown handling when binding fails after a signal arrived", async () => {
    const port = await occupyPort("localhost");
    const { host, logger, started } = start({ host: "localhost", port });

    host.emit("SIGTERM", "SIGTERM");

    await expect(started).rejects.toMatchObject({ code: "EADDRINUSE" });
    await expect(host.exited).resolves.toBe(0);
    host.emit("SIGTERM", "SIGTERM");
    expect(logger.messages("server/shutdown")).toContain(
      "Shutdown already in progress, ignoring signal",
    );
  });

  it("undoes a failed binding attempt and allows a retry", async () => {
    const port = await occupyPort("127.0.0.1");
    const cleanup = vi.fn();
    const unrelated = () => undefined;
    const logger = new RecordingLogger();
    const host = new FakeHost();
    host.on("SIGTERM", unrelated);
    const on = vi.spyOn(host, "on");

    await expect(
      startService({
        config: makeConfig({ logger, port, cleanups: [cleanup] }),
        app: respondOk,
        host,
        state: shutdownState(),
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });

    expect(on.mock.calls.map(([event]) => event)).toEqual([
      "uncaughtException",
      "unhandledRejection",
      "SIGTERM",
      "SIGINT",
    ]);
    expect(host.eventNames()).toEqual(["SIGTERM"]);
    expect(host.listeners("SIGTERM")).toEqual([unrelated]);
    expect(servers[1]?.listening).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
    expect(host.exitCodes).toEqual([]);
    expect(logger.entries).toEqual([]);

    await expect(start().started).resolves.toBeDefined();
  });
});
