import { afterEach, describe, expect, it, vi } from "vitest";
import { createContextFetch } from "../../src/lib/context/context-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  const response = new Response("ok");
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, response };
}

function sentHeaders(fetchMock: ReturnType<typeof stubFetch>["fetchMock"]) {
  const init = fetchMock.mock.calls[0]?.[1];
  return Object.fromEntries(new Headers(init?.headers));
}

describe("createContextFetch", () => {
  const contextFetch = createContextFetch(() => ({ "x-tenant": "acme", "x-trace": "t-1" }));

  it("sends the context headers and resolves with the global fetch's response", async () => {
    const { fetchMock, response } = stubFetch();

    await expect(contextFetch("https://example.test/a")).resolves.toBe(response);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.test/a");
    expect(sentHeaders(fetchMock)).toEqual({ "x-tenant": "acme", "x-trace": "t-1" });
  });

  it("lets headers passed to the call take precedence, case-insensitively", async () => {
    const { fetchMock } = stubFetch();

    await contextFetch("https://example.test", {
      headers: { "X-Tenant": "override", accept: "*/*" },
    });

    expect(sentHeaders(fetchMock)).toEqual({
      accept: "*/*",
      "x-tenant": "override",
      "x-trace": "t-1",
    });
  });

  it("passes the other request options through unchanged", async () => {
    const { fetchMock } = stubFetch();
    const signal = AbortSignal.timeout(1_000);

    await contextFetch("https://example.test", { method: "POST", body: "payload", signal });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: "payload", signal });
  });

  it("keeps the headers of a Request input", async () => {
    const { fetchMock } = stubFetch();
    const input = new Request("https://example.test", { headers: { "x-tenant": "from-request" } });

    await contextFetch(input);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(input);
    expect(sentHeaders(fetchMock)).toEqual({ "x-tenant": "from-request", "x-trace": "t-1" });
  });

  it("uses headers passed to the call instead of a Request's headers, like fetch", async () => {
    const { fetchMock } = stubFetch();
    const input = new Request("https://example.test", { headers: { "x-ignored": "yes" } });

    await contextFetch(input, { headers: { accept: "*/*" } });

    expect(sentHeaders(fetchMock)).toEqual({ accept: "*/*", "x-tenant": "acme", "x-trace": "t-1" });
  });

  it("reads the context headers and the global fetch at call time", async () => {
    let tenant = "first";
    const lateFetch = createContextFetch(() => ({ "x-tenant": tenant }));
    const { fetchMock } = stubFetch();

    tenant = "second";
    await lateFetch(new URL("https://example.test"));

    expect(sentHeaders(fetchMock)).toEqual({ "x-tenant": "second" });
  });

  it("rejects instead of throwing when headers are invalid", async () => {
    stubFetch();
    const failing = createContextFetch(() => {
      throw new TypeError("invalid context value");
    });

    const result = failing("https://example.test");

    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toThrow(new TypeError("invalid context value"));
    await expect(
      contextFetch("https://example.test", { headers: { "bad name": "x" } }),
    ).rejects.toThrow(TypeError);
  });
});
