import { afterEach, describe, expect, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import { configureService, type ContextRequest } from "../src/index.js";
import { releaseListen } from "../src/lib/lifecycle/listen-reservation.js";
import { RecordingLogger } from "./helpers/logger.js";

const PROCESS_EVENTS = ["SIGTERM", "SIGINT", "uncaughtException", "unhandledRejection"];

type Listener = (...args: unknown[]) => void;

function listenersOf(event: string): Listener[] {
  return process.listeners(event as NodeJS.Signals) as Listener[];
}

function processListeners(): Record<string, Listener[]> {
  return Object.fromEntries(PROCESS_EVENTS.map((event) => [event, listenersOf(event)]));
}

afterEach(() => {
  releaseListen();
});

describe("public API", () => {
  it("exports configureService as the only runtime value", () => {
    expect(Object.keys(publicApi)).toEqual(["configureService"]);
  });
});

describe("configureService", () => {
  it("configures without opening sockets or registering process handlers", () => {
    const before = processListeners();

    const first = configureService({ logger: new RecordingLogger(), port: 0 });
    const second = configureService({ logger: new RecordingLogger(), port: 0 });

    expect(processListeners()).toEqual(before);
    expect(first.context).not.toBe(second.context);
  });

  it("rejects invalid configuration synchronously", () => {
    const before = processListeners();

    expect(() => configureService({ logger: new RecordingLogger(), port: 70_000 })).toThrow(
      RangeError,
    );
    expect(processListeners()).toEqual(before);
  });

  it("fixes configuration at creation while callbacks still read live state", () => {
    let defaultRegion = "eu";
    const tenant = {
      value: (request: ContextRequest) => request.headers["x-tenant"],
      required: true as boolean,
      header: "x-tenant",
    };
    const billing: ("tenant" | "region")[] = ["tenant"];
    const options = {
      logger: new RecordingLogger(),
      port: 0,
      context: {
        tenant,
        region: { value: () => defaultRegion, header: "x-region" },
      },
      destinations: { billing },
    };
    const service = configureService(options);

    tenant.required = false;
    billing.push("region");
    defaultRegion = "us";

    expect(() => {
      service.context.run({ headers: {} }, () => undefined);
    }).toThrow("Missing required context value: tenant");
    service.context.run({ headers: { "x-tenant": "acme" } }, () => {
      expect(service.context.get("region")).toBe("us");
      expect(service.context.getHeaders("billing")).toEqual({ "x-tenant": "acme" });
    });
  });

  it("listens with handlers on the real process and exits through process.exit", async () => {
    const before = processListeners();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const service = configureService({ logger: new RecordingLogger(), port: 0, host: "127.0.0.1" });

    await service.listen((_req, res) => res.end());
    const added = new Map(
      PROCESS_EVENTS.map((event) => [
        event,
        listenersOf(event).filter((listener) => !before[event]?.includes(listener)),
      ]),
    );

    try {
      expect(PROCESS_EVENTS.map((event) => added.get(event)?.length)).toEqual([1, 1, 1, 1]);

      added.get("SIGTERM")![0]!("SIGTERM");
      await vi.waitFor(() => {
        expect(exit).toHaveBeenCalledWith(0);
      });
    } finally {
      for (const [event, listeners] of added) {
        for (const listener of listeners) process.removeListener(event, listener);
      }
    }
  });
});
