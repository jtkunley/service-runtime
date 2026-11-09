import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_DESTINATION } from "../config/defaults.js";
import type { ContextEntryConfig, OutboundHeader } from "../config/service-config.js";
import { createContextFetch } from "./context-fetch.js";
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
  /** Returns a `fetch` that sends the destinations' current headers; validates names immediately. */
  readonly createFetch: (destination?: Destinations) => typeof fetch;
}

type Destinations = string | readonly string[];

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

    getHeaders(destination: Destinations = DEFAULT_DESTINATION): Record<string, string> {
      return buildOutboundHeaders(mappingsFor(destination), storage.getStore());
    },
  });

  const mappingsFor = (destination: Destinations) =>
    combineDestinations(
      destinations,
      typeof destination === "string" ? [destination] : destination,
    );

  const createFetch = (destination: Destinations = DEFAULT_DESTINATION) => {
    const mappings = mappingsFor(destination);
    return createContextFetch(() => buildOutboundHeaders(mappings, storage.getStore()));
  };

  return { context, resolve, enter, createFetch };
}

/**
 * Combines the mappings of several destinations, keeping the first mapping of each entry.
 * Throws if two destinations send different entries under the same header.
 */
function combineDestinations(
  destinations: ReadonlyMap<string, readonly OutboundHeader[]>,
  names: readonly string[],
): readonly OutboundHeader[] {
  const combined = new Map<string, OutboundHeader & { readonly destination: string }>();

  for (const name of names) {
    const mappings = destinations.get(name);
    if (mappings === undefined) throw new Error(`Unknown destination: ${name}`);

    for (const mapping of mappings) {
      const headerKey = mapping.header.toLowerCase();
      const existing = combined.get(headerKey);
      if (existing === undefined) {
        combined.set(headerKey, { ...mapping, destination: name });
      } else if (existing.entry !== mapping.entry) {
        throw new Error(
          `Destinations "${existing.destination}" and "${name}" map context entries "${existing.entry}" and "${mapping.entry}" to header "${mapping.header}"`,
        );
      }
    }
  }

  return [...combined.values()];
}

function assertContextSource(source: unknown): asserts source is ContextSource {
  const headers: unknown = (source as Partial<ContextSource> | null | undefined)?.headers;
  if (typeof headers !== "object" || headers === null) {
    throw new TypeError("context.run(source, fn) requires source.headers");
  }
}
