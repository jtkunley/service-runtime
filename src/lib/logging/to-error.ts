const UNPRINTABLE_MESSAGE = "Non-error failure value could not be converted to a string";

/**
 * Returns `value` if it is already an `Error`, otherwise wraps it with the original value as `cause`.
 * Never throws, even for hostile values such as revoked proxies.
 */
export function toError(value: unknown): Error {
  if (isError(value)) return value;
  return new Error(describe(value), { cause: value });
}

function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function describe(value: unknown): string {
  try {
    return String(value);
  } catch {
    return UNPRINTABLE_MESSAGE;
  }
}
