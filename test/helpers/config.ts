import { resolveServiceConfig } from "../../lib/config/resolve-service-config.js";
import type { ServiceConfig } from "../../lib/config/service-config.js";
import { RecordingLogger } from "./logger.js";

/** Builds validated configuration bound to an ephemeral loopback port. */
export function makeConfig(overrides: Record<string, unknown> = {}): ServiceConfig {
  return resolveServiceConfig({
    logger: new RecordingLogger(),
    port: 0,
    host: "127.0.0.1",
    ...overrides,
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
