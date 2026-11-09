export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 65_000;
export const DEFAULT_FORCE_EXIT_MS = 30_000;
export const DEFAULT_READINESS_PATH = "/readiness";
export const DEFAULT_LIVENESS_PATH = "/liveness";
export const DEFAULT_SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = Object.freeze([
  "SIGTERM",
  "SIGINT",
]);

/** How much longer the headers timeout is than the keep-alive timeout. */
export const HEADERS_TIMEOUT_MARGIN_MS = 1_000;
/** The longest the runtime waits for the root logger's `flush()` before exiting. */
export const FLUSH_TIMEOUT_MS = 1_000;
/** How often idle keep-alive connections are closed while the server drains. */
export const IDLE_CONNECTION_SWEEP_MS = 1_000;

export const MAX_PORT = 65_535;
/** The largest delay Node timers accept. */
export const MAX_TIMER_MS = 2_147_483_647;
/** Leaves room for the derived headers timeout to stay within {@link MAX_TIMER_MS}. */
export const MAX_KEEP_ALIVE_TIMEOUT_MS = MAX_TIMER_MS - HEADERS_TIMEOUT_MARGIN_MS;
