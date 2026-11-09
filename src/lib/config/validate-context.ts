import { validateHeaderName } from "node:http";
import type { ContextEntry } from "../context/types.js";
import type { ContextEntryConfig, OutboundHeader } from "./service-config.js";
import { isRecord, requireRecord } from "./validators.js";

export function validateContextEntries(entries: unknown): readonly ContextEntryConfig[] {
  if (entries === undefined) return [];
  const records = requireRecord("context", entries);
  const validated = Object.entries(records).map(([name, entry]) => validateEntry(name, entry));
  assertUniqueHeaders(validated);
  return Object.freeze(validated);
}

/** The default destination: every entry that declares a header, in configuration order. */
export function defaultDestination(
  entries: readonly ContextEntryConfig[],
): readonly OutboundHeader[] {
  return Object.freeze(entries.filter(hasHeader).map(toOutboundHeader));
}

export function validateDestinations(
  destinations: unknown,
  entries: readonly ContextEntryConfig[],
): ReadonlyMap<string, readonly OutboundHeader[]> {
  if (destinations === undefined) return new Map();
  const records = requireRecord("destinations", destinations);
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]));

  return new Map(
    Object.entries(records).map(([destination, entryNames]) => [
      destination,
      validateDestination(destination, entryNames, entriesByName),
    ]),
  );
}

function validateEntry(name: string, entry: unknown): ContextEntryConfig {
  if (!isRecord(entry) || typeof entry.value !== "function") {
    throw new TypeError(`Context entry "${name}" must provide a value(request) function`);
  }
  if (entry.required !== undefined && typeof entry.required !== "boolean") {
    throw new TypeError(`Context entry "${name}" must declare required as a boolean`);
  }
  if (entry.header !== undefined) assertHeaderName(name, entry.header);

  return Object.freeze({
    name,
    value: entry.value as ContextEntry["value"],
    required: entry.required === true,
    header: entry.header,
  });
}

function assertHeaderName(entryName: string, header: unknown): asserts header is string {
  if (typeof header !== "string" || !isValidHeaderName(header)) {
    throw new TypeError(`Context entry "${entryName}" has an invalid header name`);
  }
}

function isValidHeaderName(name: string): boolean {
  try {
    validateHeaderName(name);
    return true;
  } catch {
    return false;
  }
}

/** Every header-bearing entry joins the default destination, so header names must be unique. */
function assertUniqueHeaders(entries: readonly ContextEntryConfig[]): void {
  const entryByHeader = new Map<string, string>();
  for (const entry of entries.filter(hasHeader)) {
    const headerKey = entry.header.toLowerCase();
    const conflict = entryByHeader.get(headerKey);
    if (conflict !== undefined) {
      throw new TypeError(
        `Context entries "${conflict}" and "${entry.name}" both use header "${entry.header}"`,
      );
    }
    entryByHeader.set(headerKey, entry.name);
  }
}

function validateDestination(
  destination: string,
  entryNames: unknown,
  entriesByName: ReadonlyMap<string, ContextEntryConfig>,
): readonly OutboundHeader[] {
  if (!Array.isArray(entryNames)) {
    throw new TypeError(`Destination "${destination}" must be an array of context entry names`);
  }

  const mappings = [...new Set<unknown>(entryNames)].map((entryName) => {
    const entry = typeof entryName === "string" ? entriesByName.get(entryName) : undefined;
    if (entry === undefined) {
      throw new TypeError(
        `Destination "${destination}" lists unknown context entry "${String(entryName)}"`,
      );
    }
    if (!hasHeader(entry)) {
      throw new TypeError(
        `Destination "${destination}" lists context entry "${entry.name}", which has no header`,
      );
    }
    return toOutboundHeader(entry);
  });

  return Object.freeze(mappings);
}

function hasHeader(entry: ContextEntryConfig): entry is ContextEntryConfig & { header: string } {
  return entry.header !== undefined;
}

function toOutboundHeader(entry: ContextEntryConfig & { header: string }): OutboundHeader {
  return Object.freeze({ entry: entry.name, header: entry.header });
}
