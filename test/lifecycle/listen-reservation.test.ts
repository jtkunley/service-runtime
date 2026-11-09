import { afterEach, describe, expect, it } from "vitest";
import { releaseListen, reserveListen } from "../../src/lib/lifecycle/listen-reservation.js";

afterEach(() => {
  releaseListen();
});

describe("listen reservation", () => {
  it("allows one reservation at a time", () => {
    reserveListen();

    expect(() => {
      reserveListen();
    }).toThrow(new Error("Only one service can listen per process"));
  });

  it("can be reserved again after release", () => {
    reserveListen();
    releaseListen();

    expect(() => {
      reserveListen();
    }).not.toThrow();
  });

  it("is shared through the global symbol registry", () => {
    reserveListen();

    expect(
      (globalThis as Record<symbol, unknown>)[Symbol.for("service-runtime.listen-reservation")],
    ).toBe(true);
  });
});
