import type { Server } from 'http';
import { toError } from '../shared/errors';
import type { LogData, RootLogger } from '../shared/logger';
import { createShutdownState, type ShutdownState } from './shutdownState';

const FORCE_EXIT_MS = 30_000;
const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
/**
 * `server.close()` closes only connections idle at that moment, so a keep-alive
 * connection that finishes its response later would otherwise stay open until
 * the keep-alive timeout, past the forced-exit deadline.
 */
const IDLE_SWEEP_MS = 1_000;

export type CleanupFn = () => void | Promise<void>;

export interface GracefulShutdownOptions {
    /** From the first signal to the exit; past it the process exits 1. Default 30000. */
    forceExitMs?: number;
    /**
     * Runs before the server stops accepting connections, with readiness
     * already failing: behind a load balancer, resolve after its deregistration
     * delay so it stops routing here first.
     */
    onShutdownStart?: () => void | Promise<void>;
    state?: ShutdownState;
}

export interface GracefulShutdown {
    /** A function property, so it can be passed on its own. */
    readonly isShuttingDown: () => boolean;
}

let registered = false;

/**
 * Listeners stay registered after the first signal, so a repeated signal is
 * ignored instead of taking Node's default exit in the middle of cleanup.
 *
 * @throws Error on a second call, whose server and cleanups would otherwise be silently ignored.
 */
export function setupGracefulShutdown(
    server: Server,
    rootLogger: RootLogger,
    cleanupFns: CleanupFn[] = [],
    options: GracefulShutdownOptions = {},
): GracefulShutdown {
    const { forceExitMs = FORCE_EXIT_MS, onShutdownStart, state = createShutdownState() } = options;
    if (!Number.isInteger(forceExitMs) || forceExitMs <= 0) {
        throw new RangeError('forceExitMs must be a positive integer');
    }
    if (registered) {
        throw new Error('Graceful shutdown is already configured (one per process)');
    }
    const logger = rootLogger.child('server', 'shutdown');
    registered = true;

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
            process.exit(1);
        }, forceExitMs);

        void shutdown({ signal })
            .catch(() => 1)
            .then((exitCode) => {
                clearTimeout(forceExit);
                process.exit(exitCode);
            });
    };

    for (const signal of SHUTDOWN_SIGNALS) {
        process.on(signal, onSignal);
    }
    return { isShuttingDown: state.isShuttingDown };
}
