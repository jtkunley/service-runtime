import { AsyncLocalStorage } from "node:async_hooks";
import type { ServiceConfig } from "../config/service-config.js";
import { buildOutboundHeaders } from "./outbound-headers.js";
import {
  missingContextMessage,
  resolveContext,
  type ContextResolution,
} from "./resolve-context.js";
import type { ContextSource, ContextStore, ServiceContext } from "./types.js";

export interface RequestContext {
  /** The public context API. */
  readonly context: ServiceContext<ContextStore, string>;
  /** Resolves a store without entering it, so callers can handle missing values themselves. */
  resolve(source: ContextSource): ContextResolution;
  /** Runs `fn` with an already-resolved store as the current context. */
  enter<Result>(store: ContextStore, fn: () => Result): Result;
}

export type ContextConfig = Pick<ServiceConfig, "context" | "defaultDestination" | "destinations">;

export function createRequestContext(config: ContextConfig): RequestContext {
  const { context: entries, defaultDestination, destinations } = config;
  const storage = new AsyncLocalStorage<ContextStore>();

  const resolve = (source: ContextSource) => resolveContext(entries, source);
  const enter = <Result>(store: ContextStore, fn: () => Result) => storage.run(store, fn);

  const mappingsFor = (destination: string | undefined) => {
    if (destination === undefined) return defaultDestination;
    const mappings = destinations.get(destination);
    if (mappings === undefined) throw new Error(`Unknown destination: ${destination}`);
    return mappings;
  };

  const context: ServiceContext<ContextStore, string> = Object.freeze({
    run<Result>(source: ContextSource, fn: () => Result): Result {
      assertContextSource(source);
      const { store, missing } = resolve(source);
      if (missing.length > 0) throw new Error(missingContextMessage(missing));
      return enter(store, fn);
    },

    get(name: string): string | undefined {
      const store = storage.getStore();
      if (store === undefined) throw new Error("No request context");
      return Object.hasOwn(store, name) ? store[name] : undefined;
    },

    getStore(): ContextStore | undefined {
      return storage.getStore();
    },

    getHeaders(destination?: string): Record<string, string> {
      return buildOutboundHeaders(mappingsFor(destination), storage.getStore());
    },
  });

  return { context, resolve, enter };
}

function assertContextSource(source: unknown): asserts source is ContextSource {
  const headers: unknown = (source as Partial<ContextSource> | null | undefined)?.headers;
  if (typeof headers !== "object" || headers === null) {
    throw new TypeError("context.run(source, fn) requires source.headers");
  }
}
