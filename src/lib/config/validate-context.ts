import { validateHeaderName } from "node:http";
import type { ContextEntry } from "../context/types.js";
import { DEFAULT_DESTINATION } from "./defaults.js";
import type { ContextEntryConfig, OutboundHeader } from "./service-config.js";
import { isRecord, requireRecord } from "./validators.js";

export function validateContextEntries(entries: unknown): readonly ContextEntryConfig[] {
  if (entries === undefined) return [];
  const records = requireRecord("context", entries);
  return Object.freeze(Object.entries(records).map(([name, entry]) => validateEntry(name, entry)));
}

/** Without declared destinations, every entry with a header belongs to the default destination. */
export function validateDestinations(
  destinations: unknown,
  entries: readonly ContextEntryConfig[],
): ReadonlyMap<string, readonly OutboundHeader[]> {
  const records =
    destinations === undefined
      ? { [DEFAULT_DESTINATION]: entries.filter(hasHeader).map((entry) => entry.name) }
      : requireRecord("destinations", destinations);
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]));

  return new Map(
    Object.entries(records).map(([destination, entryNames]) => [
      destination,
      validateDestination(destination, entryNames, entriesByName),
    ]),
  );
}

function hasHeader(entry: ContextEntryConfig): boolean {
  return entry.header !== undefined;
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

function validateDestination(
  destination: string,
  entryNames: unknown,
  entriesByName: ReadonlyMap<string, ContextEntryConfig>,
): readonly OutboundHeader[] {
  if (!Array.isArray(entryNames)) {
    throw new TypeError(`Destination "${destination}" must be an array of context entry names`);
  }

  const mappingsByHeader = new Map<string, OutboundHeader>();
  for (const entryName of new Set<unknown>(entryNames)) {
    const entry = typeof entryName === "string" ? entriesByName.get(entryName) : undefined;
    if (entry === undefined) {
      throw new TypeError(
        `Destination "${destination}" lists unknown context entry "${String(entryName)}"`,
      );
    }
    if (entry.header === undefined) {
      throw new TypeError(
        `Destination "${destination}" lists context entry "${entry.name}", which has no header`,
      );
    }

    const headerKey = entry.header.toLowerCase();
    const conflict = mappingsByHeader.get(headerKey);
    if (conflict !== undefined) {
      throw new TypeError(
        `Destination "${destination}" maps context entries "${conflict.entry}" and "${entry.name}" to header "${entry.header}"`,
      );
    }
    mappingsByHeader.set(headerKey, Object.freeze({ entry: entry.name, header: entry.header }));
  }

  return Object.freeze([...mappingsByHeader.values()]);
}
