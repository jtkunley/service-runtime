import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildLogger, RootLogger } from '../../shared/logger';
import { registerFatalHandlers } from '../fatalHandlers';

type FatalEvent = 'uncaughtException' | 'unhandledRejection';
type Handler = (reason: unknown) => void;

function createMockRootLogger(): RootLogger & { childLogger: ChildLogger } {
    const childLogger: ChildLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    return { child: vi.fn(() => childLogger), childLogger };
}

describe('registerFatalHandlers', () => {
    let before: Record<FatalEvent, unknown[]>;
    let order: string[];

    /** The handlers this test registered, never the test runner's own. */
    const added = (event: FatalEvent): Handler[] =>
        process
            .listeners(event)
            .filter((listener) => !before[event].includes(listener)) as unknown as Handler[];

    beforeEach(() => {
        before = {
            uncaughtException: process.listeners('uncaughtException'),
            unhandledRejection: process.listeners('unhandledRejection'),
        };
        order = [];
        vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            order.push(`exit ${String(code)}`);
        }) as typeof process.exit);
    });

    afterEach(() => {
        for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
            for (const handler of added(event)) {
                process.removeListener(event, handler);
            }
        }
        vi.restoreAllMocks();
    });

    const loggingInOrder = () => {
        const root = createMockRootLogger();
        vi.mocked(root.childLogger.error).mockImplementation((message) => {
            order.push(`log ${message}`);
        });
        return root;
    };

    describe('registration', () => {
        it('adds one handler for each event, logging through the server/fatal child', () => {
            const root = createMockRootLogger();

            registerFatalHandlers(root);

            expect(root.child).toHaveBeenCalledWith('server', 'fatal');
            expect(added('uncaughtException')).toHaveLength(1);
            expect(added('unhandledRejection')).toHaveLength(1);
        });
    });

    describe('handling', () => {
        it.each([
            ['uncaughtException', 'Uncaught exception, exiting'],
            ['unhandledRejection', 'Unhandled promise rejection, exiting'],
        ] as const)('logs an %s with its error, then exits 1', (event, message) => {
            const root = loggingInOrder();
            registerFatalHandlers(root);
            const error = new Error('boom');

            added(event)[0]?.(error);

            expect(root.childLogger.error).toHaveBeenCalledWith(message, error, {});
            expect(order).toEqual([`log ${message}`, 'exit 1']);
        });

        it('lets a logger that can flush write the line out before exiting', async () => {
            let flushed = (): void => undefined;
            const root = loggingInOrder();
            root.flush = vi.fn(
                () =>
                    new Promise<void>(
                        (resolve) => (flushed = () => resolve(void order.push('flushed'))),
                    ),
            );
            registerFatalHandlers(root);

            added('uncaughtException')[0]?.(new Error('boom'));
            await new Promise((resolve) => setTimeout(resolve, 5));
            expect(order).toEqual(['log Uncaught exception, exiting']);
            flushed();

            await vi.waitFor(() =>
                expect(order).toEqual(['log Uncaught exception, exiting', 'flushed', 'exit 1']),
            );
        });

        it('logs a failure that arrives while flushing, and still exits only once', async () => {
            let flushed = (): void => undefined;
            const root = loggingInOrder();
            root.flush = () => new Promise<void>((resolve) => (flushed = resolve));
            registerFatalHandlers(root);

            added('uncaughtException')[0]?.(new Error('first'));
            added('unhandledRejection')[0]?.(new Error('second'));
            await new Promise((resolve) => setTimeout(resolve, 5));
            flushed();

            await vi.waitFor(() => expect(order).toContain('exit 1'));
            expect(order).toEqual([
                'log Uncaught exception, exiting',
                'log Unhandled promise rejection, exiting',
                'exit 1',
            ]);
        });

        it('wraps a reason that is not an Error in one, keeping it as the cause', () => {
            const root = createMockRootLogger();
            registerFatalHandlers(root);
            const reason = { code: 'E_PLAIN' };

            added('unhandledRejection')[0]?.(reason);

            const [, error] = vi.mocked(root.childLogger.error).mock.calls[0]!;
            expect(error).toEqual(new Error('[object Object]'));
            expect(error.cause).toBe(reason);
        });

        it('still exits 1 when the logger throws', () => {
            const root = createMockRootLogger();
            vi.mocked(root.childLogger.error).mockImplementation(() => {
                throw new Error('logger broken');
            });
            registerFatalHandlers(root);

            expect(() => added('uncaughtException')[0]?.(new Error('boom'))).toThrow(
                'logger broken',
            );
            expect(order).toEqual(['exit 1']);
        });

        it('still exits 1 when the reason cannot be turned into a string', () => {
            registerFatalHandlers(createMockRootLogger());

            expect(() => added('uncaughtException')[0]?.(Object.create(null))).toThrow(TypeError);
            expect(order).toEqual(['exit 1']);
        });
    });
});
