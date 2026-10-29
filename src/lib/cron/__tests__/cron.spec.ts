import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCron, type CronOptions } from '../cron';

const cronMocks = vi.hoisted(() => {
    let tick: (() => void) | undefined;
    const task = { start: vi.fn(), stop: vi.fn() };
    const createTask = vi.fn((_schedule: string, callback: () => void, _opts?: unknown) => {
        tick = callback;
        return task;
    });
    return { createTask, task, tick: () => tick!() };
});

vi.mock('node-cron', () => ({ createTask: cronMocks.createTask }));

const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** A run that stays in progress until released. */
function gatedRun() {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const run = vi.fn(() => gate);
    return { run, release };
}

const create = (options: Partial<CronOptions> = {}) =>
    createCron({
        name: 'job',
        schedule: '* * * * *',
        run: vi.fn().mockResolvedValue(undefined),
        ...options,
    });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('createCron', () => {
    describe('scheduling', () => {
        it('creates the node-cron task, named after the job, without starting it', () => {
            const job = create({ name: 'my-job', schedule: '0 * * * *' });

            expect(cronMocks.createTask).toHaveBeenCalledWith('0 * * * *', expect.any(Function), {
                name: 'my-job',
            });
            expect(cronMocks.task.start).not.toHaveBeenCalled();
            expect(job.isStarted()).toBe(false);
        });

        it('start starts the task once, however often it is called, and logs it', () => {
            const logger = makeLogger();
            const job = create({ name: 'my-job', schedule: '0 * * * *', logger });

            job.start();
            job.start();

            expect(cronMocks.task.start).toHaveBeenCalledOnce();
            expect(logger.info).toHaveBeenCalledOnce();
            expect(logger.info).toHaveBeenCalledWith('Cron "my-job" started', {
                name: 'my-job',
                schedule: '0 * * * *',
            });
            expect(job.isStarted()).toBe(true);
        });

        it('runs the job on each tick, and is active only while a run is in progress', async () => {
            const { run, release } = gatedRun();
            const job = create({ run });
            job.start();
            expect(job.isActive()).toBe(false);

            cronMocks.tick();

            expect(run).toHaveBeenCalledOnce();
            expect(job.isActive()).toBe(true);
            release();
            await vi.waitFor(() => expect(job.isActive()).toBe(false));
        });
    });

    describe('overlapping runs', () => {
        it('by default skips a tick while the previous run is in progress, and warns', async () => {
            const logger = makeLogger();
            const { run, release } = gatedRun();
            const job = create({ name: 'serial', run, logger });
            job.start();

            cronMocks.tick();
            cronMocks.tick();

            expect(run).toHaveBeenCalledOnce();
            expect(logger.warn).toHaveBeenCalledWith(
                'Cron "serial" skipped: previous run still in progress',
                { name: 'serial' },
            );
            release();
            await vi.waitFor(() => expect(job.isActive()).toBe(false));
        });

        it('runs the next tick once the previous run has finished, even if it failed', async () => {
            const run = vi
                .fn()
                .mockRejectedValueOnce(new Error('first failed'))
                .mockResolvedValue(undefined);
            const job = create({ run });
            job.start();

            cronMocks.tick();
            await vi.waitFor(() => expect(job.isActive()).toBe(false));
            cronMocks.tick();

            expect(run).toHaveBeenCalledTimes(2);
        });

        it('with allowOverlap starts a run on every tick', async () => {
            const logger = makeLogger();
            const { run, release } = gatedRun();
            const job = create({ run, logger, allowOverlap: true });
            job.start();

            cronMocks.tick();
            cronMocks.tick();

            expect(run).toHaveBeenCalledTimes(2);
            expect(logger.warn).not.toHaveBeenCalled();
            release();
            await vi.waitFor(() => expect(job.isActive()).toBe(false));
        });
    });

    describe('a failing run', () => {
        it('is logged, then passed to onError', async () => {
            const logger = makeLogger();
            const error = new Error('boom');
            const order: string[] = [];
            logger.error.mockImplementation(() => order.push('logged'));
            const onError = vi.fn(() => order.push('onError'));

            create({ name: 'fail', run: () => Promise.reject(error), onError, logger }).start();
            cronMocks.tick();

            await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
            expect(logger.error).toHaveBeenCalledWith('Cron "fail" run failed', error, {
                name: 'fail',
            });
            expect(order).toEqual(['logged', 'onError']);
        });

        it('is wrapped in an Error for the log when it is not one, keeping it as the cause', async () => {
            const logger = makeLogger();
            const reason = { code: 'E_PLAIN' };

            create({
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- jobs can reject with anything
                run: () => Promise.reject(reason),
                logger,
            }).start();
            cronMocks.tick();

            await vi.waitFor(() => expect(logger.error).toHaveBeenCalledOnce());
            const [, logged] = logger.error.mock.calls[0] as [string, Error];
            expect(logged).toEqual(new Error('[object Object]'));
            expect(logged.cause).toBe(reason);
        });

        it('is logged even when onError throws, which is logged too and never escapes', async () => {
            const logger = makeLogger();
            const unhandled = vi.fn();
            process.on('unhandledRejection', unhandled);
            try {
                const job = create({
                    name: 'hook',
                    run: () => Promise.reject(new Error('run failed')),
                    onError: () => {
                        throw new Error('hook failed');
                    },
                    logger,
                });
                job.start();
                cronMocks.tick();

                await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(2));
                expect(logger.error.mock.calls.map((call) => String(call[0]))).toEqual([
                    'Cron "hook" run failed',
                    'Cron "hook" onError hook failed',
                ]);
                await new Promise((resolve) => setTimeout(resolve, 5));
                expect(unhandled).not.toHaveBeenCalled();
            } finally {
                process.off('unhandledRejection', unhandled);
            }
        });

        it('reaches onError without a logger', async () => {
            const onError = vi.fn();

            create({ run: () => Promise.reject(new Error('boom')), onError }).start();
            cronMocks.tick();

            await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
        });
    });

    describe('stop', () => {
        it('stops the task and logs it, and does nothing when not started', async () => {
            const logger = makeLogger();
            const job = create({ name: 's', logger });

            await job.stop();
            expect(cronMocks.task.stop).not.toHaveBeenCalled();

            job.start();
            await job.stop();

            expect(cronMocks.task.stop).toHaveBeenCalledOnce();
            expect(logger.info).toHaveBeenCalledWith('Cron "s" stopped', { name: 's' });
            expect(job.isStarted()).toBe(false);
        });

        it('ignores a tick that arrives after it', async () => {
            const run = vi.fn().mockResolvedValue(undefined);
            const job = create({ run });
            job.start();
            await job.stop();

            cronMocks.tick();

            expect(run).not.toHaveBeenCalled();
        });

        it('lets the job run again after a restart', async () => {
            const run = vi.fn().mockResolvedValue(undefined);
            const job = create({ run });
            job.start();
            await job.stop();

            job.start();
            cronMocks.tick();

            expect(run).toHaveBeenCalledOnce();
            expect(cronMocks.task.start).toHaveBeenCalledTimes(2);
        });

        it('by default waits for the run in progress to finish', async () => {
            const { run, release } = gatedRun();
            const job = create({ run });
            job.start();
            cronMocks.tick();

            let stopped = false;
            const stopping = job.stop().then(() => (stopped = true));
            await new Promise((resolve) => setTimeout(resolve, 5));
            expect(stopped).toBe(false);

            release();
            await stopping;
            expect(job.isActive()).toBe(false);
        });

        it('still resolves when the run it waits for fails', async () => {
            let fail = (): void => undefined;
            const run = vi.fn(
                () =>
                    new Promise<void>(
                        (_resolve, reject) => (fail = () => reject(new Error('boom'))),
                    ),
            );
            const job = create({ run });
            job.start();
            cronMocks.tick();

            const stopping = job.stop();
            fail();

            await expect(stopping).resolves.toBeUndefined();
        });

        it('with waitForCompletionOnStop false returns without waiting for the run', async () => {
            const { run, release } = gatedRun();
            const job = create({ run, waitForCompletionOnStop: false });
            job.start();
            cronMocks.tick();

            await job.stop();

            expect(job.isActive()).toBe(true);
            release();
            await vi.waitFor(() => expect(job.isActive()).toBe(false));
        });
    });
});
