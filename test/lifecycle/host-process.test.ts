import { describe, expect, it } from "vitest";
import { ProcessHandlers } from "../../lib/lifecycle/host-process.js";
import { FakeHost } from "../helpers/host.js";

describe("ProcessHandlers", () => {
  it("installs listeners on the host", () => {
    const host = new FakeHost();
    const received: unknown[] = [];
    const handlers = new ProcessHandlers(host);

    handlers.install("SIGTERM", (value) => received.push(value));
    host.emit("SIGTERM", "SIGTERM");

    expect(received).toEqual(["SIGTERM"]);
  });

  it("removes only the listeners it installed", () => {
    const host = new FakeHost();
    const unrelated = () => undefined;
    host.on("SIGTERM", unrelated);
    const handlers = new ProcessHandlers(host);
    handlers.install("SIGTERM", () => undefined);
    handlers.install("uncaughtException", () => undefined);

    handlers.removeAll();
    handlers.removeAll();

    expect(host.listeners("SIGTERM")).toEqual([unrelated]);
    expect(host.listenerCount("uncaughtException")).toBe(0);
  });
});
