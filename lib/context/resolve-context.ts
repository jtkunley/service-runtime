import type { ContextEntryConfig } from "../config/service-config.js";
import type { ContextRequest, ContextSource, ContextStore } from "./types.js";

export interface ContextResolution {
  readonly store: ContextStore;
  /** Names of required entries that resolved to nothing, in configuration order. */
  readonly missing: readonly string[];
}

/** Runs every resolver once and collects the trimmed values into an immutable store. */
export function resolveContext(
  entries: readonly ContextEntryConfig[],
  source: ContextSource,
): ContextResolution {
  const request = toContextRequest(source);
  const missing: string[] = [];

  const values = entries.map((entry) => {
    const value = resolveEntry(entry, request);
    if (value === undefined && entry.required) missing.push(entry.name);
    return [entry.name, value] as const;
  });

  return { store: Object.freeze(Object.fromEntries(values)), missing };
}

export function missingContextMessage(missing: readonly string[]): string {
  const noun = missing.length === 1 ? "value" : "values";
  return `Missing required context ${noun}: ${missing.join(", ")}`;
}

function resolveEntry(entry: ContextEntryConfig, request: ContextRequest): string | undefined {
  const value: unknown = entry.value(request);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    // A wrongly returned promise must not reject later as an unhandled (fatal) rejection.
    if (value instanceof Promise) value.catch(() => undefined);
    throw new TypeError(`Context entry "${entry.name}" must resolve to a string or undefined`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function toContextRequest(source: ContextSource): ContextRequest {
  return Object.freeze({
    headers: normalizeHeaders(source.headers),
    method: source.method,
    path: source.path,
  });
}

/** Builds a prototype-free header object so lookups like `headers.constructor` find nothing. */
function normalizeHeaders(headers: ContextSource["headers"]): ContextRequest["headers"] {
  const normalized: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const key = name.toLowerCase();
    const joined = typeof value === "string" ? value : value.join(", ");
    const existing = normalized[key];
    normalized[key] = existing === undefined ? joined : `${existing}, ${joined}`;
  }

  return Object.freeze(normalized);
}
