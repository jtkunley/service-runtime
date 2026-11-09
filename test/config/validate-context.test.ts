import { describe, expect, it } from "vitest";
import {
  validateContextEntries,
  validateDestinations,
} from "../../src/lib/config/validate-context.js";

const value = () => undefined;

describe("validateContextEntries", () => {
  it("returns no entries when context is omitted", () => {
    expect(validateContextEntries(undefined)).toEqual([]);
  });

  it("normalizes entries in declaration order", () => {
    const entries = validateContextEntries({
      tenant: { value, required: true, header: "X-Tenant" },
      traceId: { value },
    });

    expect(entries).toEqual([
      { name: "tenant", value, required: true, header: "X-Tenant" },
      { name: "traceId", value, required: false, header: undefined },
    ]);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries[0])).toBe(true);
  });

  it("snapshots entries so later changes have no effect", () => {
    const tenant: { value: () => string | undefined; required: boolean; header: string } = {
      value,
      required: true,
      header: "x-tenant",
    };
    const options: Record<string, unknown> = { tenant };
    const entries = validateContextEntries(options);

    tenant.required = false;
    tenant.header = "x-other";
    tenant.value = () => "changed";
    options.extra = { value };

    expect(entries).toEqual([{ name: "tenant", value, required: true, header: "x-tenant" }]);
  });

  it("rejects a non-object context", () => {
    expect(() => validateContextEntries("tenant")).toThrow(
      new TypeError("context must be an object"),
    );
  });

  it.each([null, "x", {}, { value: "x" }])("rejects entry %j without a value function", (entry) => {
    expect(() => validateContextEntries({ tenant: entry })).toThrow(
      new TypeError('Context entry "tenant" must provide a value(request) function'),
    );
  });

  it("rejects a non-boolean required flag", () => {
    expect(() => validateContextEntries({ tenant: { value, required: "yes" } })).toThrow(
      new TypeError('Context entry "tenant" must declare required as a boolean'),
    );
  });

  it.each(["", "x tenant", "x-tenant:", "tenänt", 5])("rejects header name %j", (header) => {
    expect(() => validateContextEntries({ tenant: { value, header } })).toThrow(
      new TypeError('Context entry "tenant" has an invalid header name'),
    );
  });
});

describe("validateDestinations", () => {
  const entries = validateContextEntries({
    tenant: { value, header: "X-Tenant" },
    traceId: { value, header: "x-trace-id" },
    alias: { value, header: "x-tenant" },
    local: { value },
  });

  it("puts every entry with a header in the default destination when omitted", () => {
    const withoutAlias = entries.filter((entry) => entry.name !== "alias");

    expect([...validateDestinations(undefined, withoutAlias)]).toEqual([
      [
        "default",
        [
          { entry: "tenant", header: "X-Tenant" },
          { entry: "traceId", header: "x-trace-id" },
        ],
      ],
    ]);
  });

  it("declares an empty default destination when omitted without entries", () => {
    expect([...validateDestinations(undefined, [])]).toEqual([["default", []]]);
  });

  it("rejects conflicting headers in the implicit default destination", () => {
    expect(() => validateDestinations(undefined, entries)).toThrow(
      new TypeError(
        'Destination "default" maps context entries "tenant" and "alias" to header "x-tenant"',
      ),
    );
  });

  it("declares no default destination when destinations are given without one", () => {
    expect([...validateDestinations({ billing: ["tenant"] }, entries).keys()]).toEqual(["billing"]);
  });

  it("maps each destination to its entries' outbound headers", () => {
    const destinations = validateDestinations(
      { billing: ["tenant", "traceId"], audit: ["traceId"], empty: [] },
      entries,
    );

    expect([...destinations]).toEqual([
      [
        "billing",
        [
          { entry: "tenant", header: "X-Tenant" },
          { entry: "traceId", header: "x-trace-id" },
        ],
      ],
      ["audit", [{ entry: "traceId", header: "x-trace-id" }]],
      ["empty", []],
    ]);
  });

  it("lists a repeated entry once", () => {
    const destinations = validateDestinations({ billing: ["tenant", "tenant"] }, entries);
    expect(destinations.get("billing")).toEqual([{ entry: "tenant", header: "X-Tenant" }]);
  });

  it("allows the same header in different destinations", () => {
    const destinations = validateDestinations({ a: ["tenant"], b: ["alias"] }, entries);
    expect(destinations.size).toBe(2);
  });

  it("snapshots destination lists", () => {
    const billing = ["tenant"];
    const destinations = validateDestinations({ billing }, entries);
    billing.push("traceId");

    expect(destinations.get("billing")).toHaveLength(1);
  });

  it("rejects a non-object destinations option", () => {
    expect(() => validateDestinations([], entries)).toThrow(
      new TypeError("destinations must be an object"),
    );
  });

  it("rejects a destination that is not an array", () => {
    expect(() => validateDestinations({ billing: "tenant" }, entries)).toThrow(
      new TypeError('Destination "billing" must be an array of context entry names'),
    );
  });

  it.each(["region", 7])("rejects unknown entry %j", (entryName) => {
    expect(() => validateDestinations({ billing: [entryName] }, entries)).toThrow(
      new TypeError(`Destination "billing" lists unknown context entry "${String(entryName)}"`),
    );
  });

  it("rejects an entry without a header", () => {
    expect(() => validateDestinations({ billing: ["local"] }, entries)).toThrow(
      new TypeError('Destination "billing" lists context entry "local", which has no header'),
    );
  });

  it("rejects two entries mapped to the same case-insensitive header", () => {
    expect(() => validateDestinations({ billing: ["tenant", "alias"] }, entries)).toThrow(
      new TypeError(
        'Destination "billing" maps context entries "tenant" and "alias" to header "x-tenant"',
      ),
    );
  });
});
