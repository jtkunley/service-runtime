import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_DESTINATION } from "../config/defaults.js";
import type { ContextEntryConfig, OutboundHeader } from "../config/service-config.js";
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

export function createRequestContext(
  entries: readonly ContextEntryConfig[],
  destinations: ReadonlyMap<string, readonly OutboundHeader[]>,
): RequestContext {
  const storage = new AsyncLocalStorage<ContextStore>();

  const resolve = (source: ContextSource) => resolveContext(entries, source);
  const enter = <Result>(store: ContextStore, fn: () => Result) => storage.run(store, fn);

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

    getHeaders(destination: string = DEFAULT_DESTINATION): Record<string, string> {
      const mappings = destinations.get(destination);
      if (mappings === undefined) throw new Error(`Unknown destination: ${destination}`);
      return buildOutboundHeaders(mappings, storage.getStore());
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
