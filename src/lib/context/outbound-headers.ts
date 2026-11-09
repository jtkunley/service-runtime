import { validateHeaderValue } from "node:http";
import type { OutboundHeader } from "../config/service-config.js";
import type { ContextStore } from "./types.js";

/**
 * Builds a fresh header object from the destination's defined values.
 * Throws without returning a partial result if any value is not a valid HTTP header value.
 */
export function buildOutboundHeaders(
  mappings: readonly OutboundHeader[],
  store: ContextStore | undefined,
): Record<string, string> {
  if (store === undefined) return {};

  const headers: [string, string][] = [];
  for (const { entry, header } of mappings) {
    const value = store[entry];
    if (value === undefined) continue;
    assertValidHeaderValue(entry, header, value);
    headers.push([header, value]);
  }

  return Object.fromEntries(headers);
}

function assertValidHeaderValue(entry: string, header: string, value: string): void {
  try {
    validateHeaderValue(header, value);
  } catch {
    throw new TypeError(
      `Context entry "${entry}" has a value that is not valid for header "${header}"`,
    );
  }
}
