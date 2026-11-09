import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createProbeHandler } from "../../lib/http/probes.js";

class FakeResponse {
  statusCode = 0;
  readonly headers: Record<string, string> = {};
  ended = false;
  body: unknown;

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  end(body?: unknown): void {
    this.ended = true;
    this.body = body;
  }
}

function probe(
  method: string | undefined,
  url: string | undefined,
  options: {
    shuttingDown?: boolean;
    readiness?: string | undefined;
    liveness?: string | undefined;
  } = {},
) {
  const handle = createProbeHandler(
    {
      readiness: "readiness" in options ? options.readiness : "/readiness",
      liveness: "liveness" in options ? options.liveness : "/liveness",
    },
    () => options.shuttingDown ?? false,
  );
  const response = new FakeResponse();
  const handled = handle({ method, url } as IncomingMessage, response as unknown as ServerResponse);
  return { handled, response };
}

describe("probe handler", () => {
  it.each(["GET", "HEAD"])("answers %s readiness with 200 and an empty body", (method) => {
    const { handled, response } = probe(method, "/readiness");

    expect(handled).toBe(true);
    expect(response).toMatchObject({ statusCode: 200, ended: true, body: undefined });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("fails readiness with 503 once shutting down", () => {
    expect(probe("GET", "/readiness", { shuttingDown: true }).response.statusCode).toBe(503);
  });

  it("keeps liveness at 200 while shutting down", () => {
    const { handled, response } = probe("GET", "/liveness", { shuttingDown: true });

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
  });

  it("ignores query strings when matching", () => {
    expect(probe("GET", "/liveness?verbose=1").handled).toBe(true);
  });

  it.each([
    ["other methods", "POST", "/readiness"],
    ["unrelated paths", "GET", "/orders"],
    ["prefixed paths", "GET", "/readiness/extra"],
    ["requests without a URL", "GET", undefined],
  ])("passes %s through", (_label, method, url) => {
    const { handled, response } = probe(method, url);

    expect(handled).toBe(false);
    expect(response.ended).toBe(false);
  });

  it("passes disabled probe paths through", () => {
    expect(probe("GET", "/readiness", { readiness: undefined }).handled).toBe(false);
  });

  it("uses custom probe paths", () => {
    expect(probe("GET", "/ready", { readiness: "/ready" }).handled).toBe(true);
  });
});
