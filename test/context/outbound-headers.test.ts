import { describe, expect, it } from "vitest";
import { buildOutboundHeaders } from "../../src/lib/context/outbound-headers.js";

const mappings = [
  { entry: "tenant", header: "X-Tenant" },
  { entry: "traceId", header: "x-trace-id" },
];

describe("buildOutboundHeaders", () => {
  it("returns an empty object outside a context", () => {
    expect(buildOutboundHeaders(mappings, undefined)).toEqual({});
  });

  it("includes only defined values under their configured header names", () => {
    expect(buildOutboundHeaders(mappings, { tenant: "acme", traceId: undefined })).toEqual({
      "X-Tenant": "acme",
    });
  });

  it("returns a fresh object on every call", () => {
    const store = { tenant: "acme", traceId: "t-1" };
    const first = buildOutboundHeaders(mappings, store);
    first["X-Tenant"] = "changed";

    expect(buildOutboundHeaders(mappings, store)).toEqual({
      "X-Tenant": "acme",
      "x-trace-id": "t-1",
    });
  });

  it("keeps a __proto__ header as an ordinary own property", () => {
    const headers = buildOutboundHeaders([{ entry: "proto", header: "__proto__" }], {
      proto: "value",
    });

    expect(Object.hasOwn(headers, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(headers)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(headers, "__proto__")?.value).toBe("value");
  });

  it("rejects invalid values without exposing them or returning a partial result", () => {
    const build = () => buildOutboundHeaders(mappings, { tenant: "acme", traceId: "bad\r\nvalue" });

    expect(build).toThrow(
      new TypeError(
        'Context entry "traceId" has a value that is not valid for header "x-trace-id"',
      ),
    );
    expect(build).not.toThrow(/bad/);
  });
});
