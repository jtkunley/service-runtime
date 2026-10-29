import type { Server } from 'http';
import { toError } from '../shared/errors';
import type { LogData, RootLogger } from '../shared/logger';
import { exitAfterFlush } from '../shared/exitAfterFlush';
import type { ShutdownState } from './shutdownState';

const FORCE_EXIT_MS = 30_000;
/**
 * `server.close()` closes only connections idle at that moment, so a keep-alive
 * connection that finishes its response later would otherwise stay open until
 * the keep-alive timeout, past the forced-exit deadline.
 */
const IDLE_SWEEP_MS = 1_000;

export type CleanupFn = () => void | Promise<void>;

export interface GracefulShutdownOptions {
    /**
     * From the first signal to the exit; past it the process exits 1, after up
     * to a second for the logger to flush. Default 30000.
     */
    forceExitMs?: number;
    /**
     * Runs before the server stops accepting connections, with readiness
     * already failing: behind a load balancer, resolve after its deregistration
     * delay so it stops routing here first.
     */
    onShutdownStart?: () => void | Promise<void>;
    /** Begun on the first signal, which fails readiness. */
    state: ShutdownState;
    signals: readonly NodeJS.Signals[];
}

/**
 * Listeners stay registered after the first signal, so a repeated signal is
 * ignored instead of taking Node's default exit in the middle of cleanup.
 */
export function setupGracefulShutdown(
    server: Server,
    rootLogger: RootLogger,
    cleanupFns: readonly CleanupFn[],
    { forceExitMs = FORCE_EXIT_MS, onShutdownStart, state, signals }: GracefulShutdownOptions,
): void {
    const logger = rootLogger.child('server', 'shutdown');

    const closeServer = (onError: (err: Error) => void): Promise<void> =>
        new Promise((resolve) => {
            const sweep = setInterval(() => {
                server.closeIdleConnections();
            }, IDLE_SWEEP_MS);
            sweep.unref();
            server.close((err) => {
                clearInterval(sweep);
                if (err) onError(err);
                resolve();
            });
        });

    const shutdown = async (data: LogData): Promise<number> => {
        let exitCode = 0;
        const fail = (message: string, err: unknown, extra?: LogData): void => {
            exitCode = 1;
            logger.error(message, toError(err), { ...data, ...extra });
        };

        logger.info('Received shutdown signal, closing server...', data);
        try {
            await onShutdownStart?.();
        } catch (err) {
            fail('Error in onShutdownStart', err);
        }
        await closeServer((err) => fail('Error closing server', err));
        for (const [index, fn] of cleanupFns.entries()) {
            try {
                await fn();
            } catch (err) {
                fail('Error during resource cleanup', err, {
                    cleanup: fn.name || `#${String(index + 1)}`,
                });
            }
        }
        logger.info('Graceful shutdown complete', data);
        return exitCode;
    };

    let started = false;
    const onSignal = (signal: NodeJS.Signals): void => {
        if (started) {
            logger.info('Shutdown already in progress, ignoring signal', {
                signal,
            });
            return;
        }
        started = true;
        state.begin();

        const forceExit = setTimeout(() => {
            logger.error(
                'Graceful shutdown timed out, forcing exit',
                new Error('Graceful shutdown timed out'),
                { signal },
            );
            exitAfterFlush(rootLogger, 1);
        }, forceExitMs);

        void shutdown({ signal })
            .catch(() => 1)
            .then((exitCode) => {
                clearTimeout(forceExit);
                exitAfterFlush(rootLogger, exitCode);
            });
    };

    for (const signal of new Set(signals)) {
        process.on(signal, onSignal);
    }
}
