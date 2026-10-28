import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildLogger, RootLogger } from '../../shared/logger';

type Handler = (reason: unknown) => void;

function createMockRootLogger(): RootLogger & { childLogger: ChildLogger } {
    const childLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    } as unknown as ChildLogger;
    return {
        child: vi.fn(() => childLogger),
        level: vi.fn(),
        childLogger,
    } as unknown as RootLogger & { childLogger: ChildLogger };
}

describe('registerFatalHandlers', () => {
    let registerFatalHandlers: typeof import('../fatalHandlers.js').registerFatalHandlers;
    let before: Record<'uncaughtException' | 'unhandledRejection', unknown[]>;
    let order: string[];

    /** The handlers this test registered, never the test runner's own. */
    const added = (
        event: 'uncaughtException' | 'unhandledRejection',
    ): Handler[] =>
        process
            .listeners(event)
            .filter(
                (listener) => !before[event].includes(listener),
            ) as unknown as Handler[];

    beforeEach(async () => {
        vi.resetModules();
        before = {
            uncaughtException: process.listeners('uncaughtException'),
            unhandledRejection: process.listeners('unhandledRejection'),
        };
        order = [];
        vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            order.push(`exit ${String(code)}`);
        }) as typeof process.exit);
        registerFatalHandlers = (await import('../fatalHandlers.js'))
            .registerFatalHandlers;
    });

    afterEach(() => {
        for (const event of [
            'uncaughtException',
            'unhandledRejection',
        ] as const) {
            for (const handler of added(event)) {
                process.removeListener(event, handler);
            }
        }
        vi.restoreAllMocks();
    });

    const loggingInto = (root: RootLogger & { childLogger: ChildLogger }) => {
        vi.mocked(root.childLogger.error).mockImplementation(
            (message: string) => {
                order.push(`log ${message}`);
            },
        );
        return root;
    };

    it('logs an uncaught exception with its error, then exits 1', () => {
        const root = loggingInto(createMockRootLogger());
        registerFatalHandlers(root);
        const error = new Error('boom');

        const [handler] = added('uncaughtException');
        handler?.(error);

        expect(root.child).toHaveBeenCalledWith('server', 'fatal');
        expect(root.childLogger.error).toHaveBeenCalledWith(
            'Uncaught exception, exiting',
            error,
            {},
        );
        expect(order).toEqual(['log Uncaught exception, exiting', 'exit 1']);
    });

    it('logs an unhandled rejection with its reason, then exits 1', () => {
        const root = loggingInto(createMockRootLogger());
        registerFatalHandlers(root);
        const reason = new Error('rejected');

        const [handler] = added('unhandledRejection');
        handler?.(reason);

        expect(root.childLogger.error).toHaveBeenCalledWith(
            'Unhandled promise rejection, exiting',
            reason,
            {},
        );
        expect(order).toEqual([
            'log Unhandled promise rejection, exiting',
            'exit 1',
        ]);
    });

    it('wraps a reason that is not an Error in one, keeping it as the cause', () => {
        const root = createMockRootLogger();
        registerFatalHandlers(root);
        const reason = { code: 'E_PLAIN' };

        added('unhandledRejection')[0]?.(reason);

        expect(root.childLogger.error).toHaveBeenCalledWith(
            'Unhandled promise rejection, exiting',
            new Error('[object Object]'),
            {},
        );
        const [, error] = vi.mocked(root.childLogger.error).mock.calls[0] ?? [];
        expect(error?.cause).toBe(reason);
    });

    it('still exits 1 for a reason String() cannot print', () => {
        registerFatalHandlers(createMockRootLogger());
        const reason: unknown = Object.create(null);

        expect(() => added('uncaughtException')[0]?.(reason)).toThrow(
            TypeError,
        );
        expect(order).toEqual(['exit 1']);
    });

    it('still exits 1 when logging throws', () => {
        const root = createMockRootLogger();
        vi.mocked(root.childLogger.error).mockImplementation(() => {
            throw new Error('logger broken');
        });
        registerFatalHandlers(root);

        expect(() =>
            added('uncaughtException')[0]?.(new Error('boom')),
        ).toThrow('logger broken');
        expect(order).toEqual(['exit 1']);
    });

    it('registers one handler for each event', () => {
        registerFatalHandlers(createMockRootLogger());

        expect(added('uncaughtException')).toHaveLength(1);
        expect(added('unhandledRejection')).toHaveLength(1);
    });

    it('throws on a second call and registers nothing more', () => {
        registerFatalHandlers(createMockRootLogger());
        const second = createMockRootLogger();

        expect(() => registerFatalHandlers(second)).toThrow(
            'Fatal handlers are already registered (one per process)',
        );
        expect(second.child).not.toHaveBeenCalled();
        expect(added('uncaughtException')).toHaveLength(1);
        expect(added('unhandledRejection')).toHaveLength(1);
    });

    it('stays unregistered when the logger cannot make its child, so a retry still registers', () => {
        const broken = createMockRootLogger();
        vi.mocked(broken.child).mockImplementation(() => {
            throw new Error('no child');
        });

        expect(() => registerFatalHandlers(broken)).toThrow('no child');
        expect(added('uncaughtException')).toHaveLength(0);

        registerFatalHandlers(createMockRootLogger());
        expect(added('uncaughtException')).toHaveLength(1);
    });
});
