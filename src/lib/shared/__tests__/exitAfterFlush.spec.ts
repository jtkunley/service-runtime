import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RootLogger } from '../logger';
import { exitAfterFlush } from '../exitAfterFlush';

const rootLogger = (flush?: () => Promise<void>): RootLogger => ({
    child: vi.fn(),
    ...(flush && { flush }),
});

describe('exitAfterFlush', () => {
    let exits: number[];

    beforeEach(() => {
        exits = [];
        vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
            exits.push(code);
        }) as typeof process.exit);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('exits at once with the code when the logger cannot flush', () => {
        exitAfterFlush(rootLogger(), 3);

        expect(exits).toEqual([3]);
    });

    it('waits for the flush, then exits', async () => {
        let flushed = (): void => undefined;
        exitAfterFlush(
            rootLogger(() => new Promise((resolve) => (flushed = resolve))),
            1,
        );

        await vi.waitFor(() => expect(flushed).not.toBe(undefined));
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(exits).toEqual([]);
        flushed();

        await vi.waitFor(() => expect(exits).toEqual([1]));
    });

    it.each([
        ['rejects', () => Promise.reject(new Error('transport down'))],
        [
            'throws',
            () => {
                throw new Error('transport down');
            },
        ],
    ])('still exits when the flush %s', async (_name, flush) => {
        exitAfterFlush(rootLogger(flush), 0);

        await vi.waitFor(() => expect(exits).toEqual([0]));
    });

    it('gives up on a flush that hangs after a second', async () => {
        vi.useFakeTimers();
        exitAfterFlush(
            rootLogger(() => new Promise(() => undefined)),
            1,
        );

        await vi.advanceTimersByTimeAsync(999);
        expect(exits).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);

        expect(exits).toEqual([1]);
    });
});
