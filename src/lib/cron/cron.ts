import cron from 'node-cron';
import { toError } from '../shared/errors';
import type { ChildLogger } from '../shared/logger';

export interface CronOptions {
    name: string;
    schedule: string;
    run: () => Promise<void>;

    logger?: ChildLogger;

    onError?: (error: unknown) => void;

    /** Default false: a tick is skipped while the previous run is still in progress. */
    allowOverlap?: boolean;
    /** Default true: `stop()` waits for in-flight runs to finish. */
    waitForCompletionOnStop?: boolean;
}

export interface CronController {
    start(): void;
    stop(): Promise<void>;
    isStarted(): boolean;
    isActive(): boolean;
}

export function createCron(options: CronOptions): CronController {
    const {
        name,
        schedule,
        run,
        logger,
        onError,
        allowOverlap = false,
        waitForCompletionOnStop = true,
    } = options;

    let started = false;
    let stopRequested = false;
    let singleRunInProgress = false;
    const pendingRuns = new Set<Promise<void>>();

    const task = cron.schedule(
        schedule,
        () => {
            void executeTick();
        },
        { scheduled: false },
    );

    async function executeTick(): Promise<void> {
        if (stopRequested) {
            return;
        }
        if (!allowOverlap && singleRunInProgress) {
            logger?.warn(
                `Cron "${name}" skipped: previous run still in progress`,
                {
                    name,
                },
            );
            return;
        }

        if (!allowOverlap) {
            singleRunInProgress = true;
        }

        const runPromise = (async () => {
            try {
                await run();
            } catch (error) {
                logger?.error(
                    `Cron "${name}" run failed`,
                    toError(error),
                    { name },
                );
                try {
                    onError?.(error);
                } catch (hookError) {
                    logger?.error(
                        `Cron "${name}" onError hook failed`,
                        toError(hookError),
                        { name },
                    );
                }
            } finally {
                if (!allowOverlap) {
                    singleRunInProgress = false;
                }
            }
        })();

        pendingRuns.add(runPromise);
        void runPromise.finally(() => {
            pendingRuns.delete(runPromise);
        });

        if (!allowOverlap) {
            await runPromise;
        }
    }

    return {
        start(): void {
            if (started) {
                return;
            }
            stopRequested = false;
            task.start();
            started = true;
            logger?.info(`Cron "${name}" started`, { name, schedule });
        },

        async stop(): Promise<void> {
            if (!started) {
                return;
            }
            stopRequested = true;
            task.stop();
            started = false;
            logger?.info(`Cron "${name}" stopped`, { name });

            if (waitForCompletionOnStop && pendingRuns.size > 0) {
                await Promise.all(
                    Array.from(pendingRuns).map((p) => p.catch(() => undefined)),
                );
            }
        },

        isStarted(): boolean {
            return started;
        },

        isActive(): boolean {
            return pendingRuns.size > 0;
        },
    };
}
