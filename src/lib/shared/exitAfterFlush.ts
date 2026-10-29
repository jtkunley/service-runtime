import type { RootLogger } from './logger';

/** Short, because it runs after the decision to exit, and past the shutdown deadline for a forced exit. */
const FLUSH_TIMEOUT_MS = 1_000;

/**
 * Exits once the logger has written what it buffered, such as the line saying
 * why the process is exiting. A logger without `flush` exits at once, and a
 * flush that fails or hangs never stops the exit.
 */
export function exitAfterFlush(rootLogger: RootLogger, code: number): void {
    if (!rootLogger.flush) {
        process.exit(code);
        return;
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
    });
    const flushed = Promise.resolve()
        .then(() => rootLogger.flush?.())
        .catch(() => undefined);
    void Promise.race([flushed, timedOut]).then(() => {
        clearTimeout(timer);
        process.exit(code);
    });
}
