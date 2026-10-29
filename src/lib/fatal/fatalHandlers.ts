import { toError } from '../shared/errors';
import type { RootLogger } from '../shared/logger';
import { exitAfterFlush } from '../shared/exitAfterFlush';

let registered = false;

/**
 * After an uncaught exception or unhandled rejection the process is in an
 * unknown state, so it logs and exits 1 at once, without graceful shutdown,
 * and leaves the restart to the orchestrator.
 * Register it first at startup so a failure while starting is caught too.
 *
 * @throws Error on a second call, which would log every failure twice.
 */
export function registerFatalHandlers(rootLogger: RootLogger): void {
    if (registered) {
        throw new Error('Fatal handlers are already registered (one per process)');
    }
    const logger = rootLogger.child('server', 'fatal');
    registered = true;

    // A failure while the logger flushes is logged too, but the exit is already under way.
    let exiting = false;
    const logAndExit = (message: string, reason: unknown): void => {
        try {
            logger.error(message, toError(reason), {});
        } finally {
            if (!exiting) {
                exiting = true;
                exitAfterFlush(rootLogger, 1);
            }
        }
    };

    process.on('uncaughtException', (error) => {
        logAndExit('Uncaught exception, exiting', error);
    });
    process.on('unhandledRejection', (reason) => {
        logAndExit('Unhandled promise rejection, exiting', reason);
    });
}
