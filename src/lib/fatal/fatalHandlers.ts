import { toError } from '../shared/errors';
import type { RootLogger } from '../shared/logger';
import { exitAfterFlush } from '../shared/exitAfterFlush';

/**
 * After an uncaught exception or unhandled rejection the process is in an
 * unknown state, so it logs and exits 1 at once, without graceful shutdown,
 * and leaves the restart to the orchestrator.
 */
export function registerFatalHandlers(rootLogger: RootLogger): void {
    const logger = rootLogger.child('server', 'fatal');

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
