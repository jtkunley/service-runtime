import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCron } from '../cron';

const cronMocks = vi.hoisted(() => {
    let tick: (() => void) | undefined;
    const task = {
        start: vi.fn(),
        stop: vi.fn(),
    };
    const schedule = vi.fn(
        (_schedule: string, callback: () => void, _opts?: unknown) => {
            tick = callback;
            return task;
        },
    );
    return {
        schedule,
        task,
        getTick: () => tick,
    };
});

vi.mock('node-cron', () => ({
    default: {
        schedule: cronMocks.schedule,
    },
}));

describe('createCron', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('registers the schedule with node-cron and does not start the task until start()', () => {
        const run = vi.fn().mockResolvedValue(undefined);
        createCron({ name: 'test', schedule: '* * * * *', run });

        expect(cronMocks.schedule).toHaveBeenCalledWith(
            '* * * * *',
            expect.any(Function),
            { scheduled: false },
        );
        expect(cronMocks.task.start).not.toHaveBeenCalled();
    });

    it('start calls task.start, logs when a logger is provided, and is idempotent', () => {
        const run = vi.fn().mockResolvedValue(undefined);
        const logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        const c = createCron({
            name: 'my-job',
            schedule: '0 * * * *',
            run,
            logger,
        });

        c.start();
        c.start();

        expect(cronMocks.task.start).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith(
            'Cron "my-job" started',
            expect.objectContaining({ name: 'my-job', schedule: '0 * * * *' }),
        );
        expect(c.isStarted()).toBe(true);
    });

    it('invokes run when the cron tick callback fires', async () => {
        const run = vi.fn().mockResolvedValue(undefined);
        const c = createCron({ name: 't', schedule: '* * * * *', run });
        c.start();

        cronMocks.getTick()!();

        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    });

    it('when allowOverlap is false, skips a tick while the previous run is still in progress', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const run = vi.fn(async () => {
            await gate;
        });
        const logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        const c = createCron({
            name: 'serial',
            schedule: '* * * * *',
            run,
            logger,
            allowOverlap: false,
        });
        c.start();

        cronMocks.getTick()!();
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

        cronMocks.getTick()!();
        expect(logger.warn).toHaveBeenCalledWith(
            'Cron "serial" skipped: previous run still in progress',
            { name: 'serial' },
        );
        expect(run).toHaveBeenCalledTimes(1);

        release();
        await vi.waitFor(() => expect(c.isActive()).toBe(false));
    });

    it('when allowOverlap is true, allows overlapping runs', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const run = vi.fn(async () => {
            await gate;
        });

        const c = createCron({
            name: 'overlap',
            schedule: '* * * * *',
            run,
            allowOverlap: true,
        });
        c.start();

        cronMocks.getTick()!();
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

        cronMocks.getTick()!();
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));

        release();
        await vi.waitFor(() => expect(c.isActive()).toBe(false));
    });

    it('calls onError and logs when run rejects', async () => {
        const err = new Error('boom');
        const run = vi.fn().mockRejectedValue(err);
        const onError = vi.fn();
        const logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        const c = createCron({
            name: 'fail',
            schedule: '* * * * *',
            run,
            onError,
            logger,
        });
        c.start();

        cronMocks.getTick()!();

        await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(err));
        expect(logger.error).toHaveBeenCalledWith(
            'Cron "fail" run failed',
            err,
            { name: 'fail' },
        );
    });

    it('stop calls task.stop, logs when a logger is provided, and is no-op when not started', async () => {
        const run = vi.fn().mockResolvedValue(undefined);
        const logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        const c = createCron({
            name: 's',
            schedule: '* * * * *',
            run,
            logger,
        });

        await c.stop();
        expect(cronMocks.task.stop).not.toHaveBeenCalled();

        c.start();
        await c.stop();

        expect(cronMocks.task.stop).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith('Cron "s" stopped', {
            name: 's',
        });
        expect(c.isStarted()).toBe(false);
    });

    it('when waitForCompletionOnStop is true, stop resolves after in-flight runs finish', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const run = vi.fn(async () => {
            await gate;
        });

        const c = createCron({
            name: 'wait',
            schedule: '* * * * *',
            run,
            waitForCompletionOnStop: true,
        });
        c.start();

        cronMocks.getTick()!();
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

        const stopPromise = c.stop();
        await Promise.resolve();
        expect(c.isActive()).toBe(true);

        release();
        await stopPromise;
        expect(c.isActive()).toBe(false);
    });

    it('when waitForCompletionOnStop is false, stop returns without waiting for the run', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const run = vi.fn(async () => {
            await gate;
        });

        const c = createCron({
            name: 'nowait',
            schedule: '* * * * *',
            run,
            waitForCompletionOnStop: false,
        });
        c.start();

        cronMocks.getTick()!();
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

        await c.stop();
        expect(c.isActive()).toBe(true);

        release();
        await vi.waitFor(() => expect(c.isActive()).toBe(false));
    });

    it('reports isActive while a run is in progress', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const run = vi.fn(async () => {
            await gate;
        });

        const c = createCron({ name: 'active', schedule: '* * * * *', run });
        c.start();

        expect(c.isActive()).toBe(false);

        cronMocks.getTick()!();
        await vi.waitFor(() => expect(c.isActive()).toBe(true));

        release();
        await vi.waitFor(() => expect(c.isActive()).toBe(false));
    });

    it('ignores ticks after stop', async () => {
        const run = vi.fn().mockResolvedValue(undefined);
        const c = createCron({ name: 'stopped', schedule: '* * * * *', run });
        c.start();
        await c.stop();

        cronMocks.getTick()!();
        await Promise.resolve();

        expect(run).not.toHaveBeenCalled();
    });
});
