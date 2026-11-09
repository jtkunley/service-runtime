import { Agent, createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { closeServer, createHttpServer, listenOn } from "../../lib/http/http-server.js";
import { delay } from "../helpers/config.js";
import { request } from "../helpers/http.js";

const servers: Server[] = [];
const agents: Agent[] = [];

function track<T extends Server>(server: T): T {
  servers.push(server);
  return server;
}

afterEach(() => {
  for (const agent of agents.splice(0)) agent.destroy();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

describe("createHttpServer", () => {
  it("derives headers and request timeouts from the keep-alive timeout", () => {
    const server = createHttpServer(() => undefined, 65_000);

    expect(server.keepAliveTimeout).toBe(65_000);
    expect(server.headersTimeout).toBe(66_000);
    expect(server.requestTimeout).toBe(300_000);
  });

  it("raises the request timeout to at least the headers timeout", () => {
    const server = createHttpServer(() => undefined, 400_000);

    expect(server.headersTimeout).toBe(401_000);
    expect(server.requestTimeout).toBe(401_000);
  });
});

describe("listenOn", () => {
  it("resolves with the bound address", async () => {
    const server = track(createServer());
    const address = await listenOn(server, 0, "127.0.0.1");

    expect(address).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
    expect(address.port).toBeGreaterThan(0);
  });

  it("uses Node's default binding when the host is omitted", async () => {
    const server = track(createServer());
    const address = await listenOn(server, 0, undefined);

    expect(["::", "0.0.0.0"]).toContain(address.address);
  });

  it("rejects binding failures such as an occupied port", async () => {
    const occupant = track(createServer());
    const { port } = await listenOn(occupant, 0, "127.0.0.1");

    await expect(listenOn(track(createServer()), port, "127.0.0.1")).rejects.toMatchObject({
      code: "EADDRINUSE",
    });
  });
});

describe("closeServer", () => {
  it("resolves once the server has closed", async () => {
    const server = track(createServer());
    await listenOn(server, 0, "127.0.0.1");

    await closeServer(server);

    expect(server.listening).toBe(false);
  });

  it("rejects when the server is not running", async () => {
    await expect(closeServer(createServer())).rejects.toMatchObject({
      code: "ERR_SERVER_NOT_RUNNING",
    });
  });

  it("promptly closes keep-alive connections that are already idle", async () => {
    const server = track(createServer((_req, res) => res.end("ok")));
    server.keepAliveTimeout = 60_000;
    const address = await listenOn(server, 0, "127.0.0.1");
    const agent = new Agent({ keepAlive: true });
    agents.push(agent);
    await request(address, { agent });

    const startedAt = Date.now();
    await closeServer(server);

    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("waits for active requests and closes connections that become idle while draining", async () => {
    let finishRequest: () => void = () => undefined;
    const server = track(
      createServer((_req, res) => {
        finishRequest = () => res.end("done");
      }),
    );
    server.keepAliveTimeout = 60_000;
    const address = await listenOn(server, 0, "127.0.0.1");
    const agent = new Agent({ keepAlive: true });
    agents.push(agent);

    const inFlight = request(address, { agent });
    await delay(50);
    let closed = false;
    const closing = closeServer(server).then(() => (closed = true));

    await delay(50);
    expect(closed).toBe(false);

    finishRequest();
    await expect(inFlight).resolves.toMatchObject({ status: 200, body: "done" });
    const becameIdleAt = Date.now();
    await closing;

    expect(Date.now() - becameIdleAt).toBeLessThan(2_000);
  });
});
