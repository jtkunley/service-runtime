import { describe, expect, it } from "vitest";
import { validateProbes } from "../../src/lib/config/validate-probes.js";

describe("validateProbes", () => {
  it("defaults to /readiness and /liveness", () => {
    expect(validateProbes(undefined)).toEqual({ readiness: "/readiness", liveness: "/liveness" });
    expect(validateProbes({})).toEqual({ readiness: "/readiness", liveness: "/liveness" });
  });

  it("keeps the default when a path is undefined", () => {
    expect(validateProbes({ readiness: undefined, liveness: "/live" })).toEqual({
      readiness: "/readiness",
      liveness: "/live",
    });
  });

  it("accepts custom paths and false to disable", () => {
    expect(validateProbes({ readiness: "/health/ready", liveness: false })).toEqual({
      readiness: "/health/ready",
      liveness: undefined,
    });
    expect(validateProbes({ readiness: false, liveness: false })).toEqual({
      readiness: undefined,
      liveness: undefined,
    });
  });

  it("returns a frozen snapshot", () => {
    expect(Object.isFrozen(validateProbes(undefined))).toBe(true);
  });

  it.each(["", "ready", "/ready?x=1", "/ready#top", true, 5, null])(
    "rejects readiness path %j",
    (readiness) => {
      expect(() => validateProbes({ readiness })).toThrow(
        new TypeError(
          "probes.readiness must be false or an absolute path without a query string or fragment",
        ),
      );
    },
  );

  it("names the invalid liveness probe", () => {
    expect(() => validateProbes({ liveness: "live" })).toThrow(/^probes\.liveness must be/);
  });

  it("rejects identical readiness and liveness paths", () => {
    expect(() => validateProbes({ readiness: "/health", liveness: "/health" })).toThrow(
      new TypeError("Readiness and liveness probes cannot share the path /health"),
    );
  });

  it("rejects a non-object probes option", () => {
    expect(() => validateProbes(false)).toThrow(new TypeError("probes must be an object"));
  });
});
