/**
 * Wraps Node's global `fetch` so every call carries the current context headers.
 * Headers supplied by the caller take precedence over context headers of the same name.
 */
export function createContextFetch(contextHeaders: () => Record<string, string>): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
    for (const [name, value] of Object.entries(contextHeaders())) {
      if (!headers.has(name)) headers.set(name, value);
    }
    return globalThis.fetch(input, { ...init, headers });
  };
}
