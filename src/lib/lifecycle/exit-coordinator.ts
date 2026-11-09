import { FLUSH_TIMEOUT_MS } from "../config/defaults.js";
import type { Logger } from "../logging/logger.js";
import type { HostProcess } from "./host-process.js";

export type ExitCode = 0 | 1;

/** Funnels every exit path into one best-effort logger flush followed by one process exit. */
export class ExitCoordinator {
  readonly #logger: Logger;
  readonly #host: HostProcess;
  #requested = false;
  #code: ExitCode = 0;

  constructor(logger: Logger, host: HostProcess) {
    this.#logger = logger;
    this.#host = host;
  }

  /** Whether any exit has been requested. */
  get requested(): boolean {
    return this.#requested;
  }

  /**
   * The first request starts the final flush; later requests can only raise the exit code
   * from 0 to 1 and never restart or extend the flush.
   */
  request(code: ExitCode): void {
    if (code > this.#code) this.#code = code;
    if (this.#requested) return;
    this.#requested = true;

    const logger = this.#logger;
    if (typeof logger.flush === "function") {
      const flush = logger.flush.bind(logger);
      void flushWithin(flush, FLUSH_TIMEOUT_MS).then(() => {
        this.#host.exit(this.#code);
      });
    } else {
      this.#host.exit(this.#code);
    }
  }
}

async function flushWithin(flush: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });

  try {
    await Promise.race([flushQuietly(flush), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function flushQuietly(flush: () => Promise<void>): Promise<void> {
  try {
    await flush();
  } catch {
    // Flushing is best effort; a failed flush must not block or alter the exit.
  }
}
