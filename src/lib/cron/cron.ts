import { createTask } from 'node-cron';
import type { Context, ContextConfig, ContextSource } from '../context/configureContext';
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

    /**
     * Each tick runs inside this context, so the job can read its values and a
     * failed run is logged with them. Leave it out for a job that sets up its own
     * contexts, such as one that works through every tenant in turn.
     */
    context?: Pick<Context<ContextConfig>, 'run' | 'getLogData'>;
    /** Where each tick's values come from. Default: no headers, so only the `value` functions decide. */
    source?: () => ContextSource;
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
        context,
        source = () => ({ headers: {} }),
    } = options;

    let started = false;
    let stopRequested = false;
    let singleRunInProgress = false;
    const pendingRuns = new Set<Promise<void>>();

    const task = createTask(
        schedule,
        () => {
            void executeTick();
        },
        { name },
    );

    function report(error: unknown): void {
        logger?.error(`Cron "${name}" run failed`, toError(error), {
            name,
            ...context?.getLogData(),
        });
        try {
            onError?.(error);
        } catch (hookError) {
            logger?.error(`Cron "${name}" onError hook failed`, toError(hookError), { name });
        }
    }

    /** Reports from inside the context, so the failure log carries the tick's values. */
    async function attempt(): Promise<void> {
        try {
            await run();
        } catch (error) {
            report(error);
        }
    }

    async function executeTick(): Promise<void> {
        if (stopRequested) {
            return;
        }
        if (!allowOverlap && singleRunInProgress) {
            logger?.warn(`Cron "${name}" skipped: previous run still in progress`, {
                name,
            });
            return;
        }

        if (!allowOverlap) {
            singleRunInProgress = true;
        }

        const runPromise = (async () => {
            try {
                await (context ? context.run(source(), attempt) : attempt());
            } catch (error) {
                report(error);
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
            void task.start();
            started = true;
            logger?.info(`Cron "${name}" started`, { name, schedule });
        },

        async stop(): Promise<void> {
            if (!started) {
                return;
            }
            stopRequested = true;
            await task.stop();
            started = false;
            logger?.info(`Cron "${name}" stopped`, { name });

            if (waitForCompletionOnStop && pendingRuns.size > 0) {
                await Promise.allSettled(pendingRuns);
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
