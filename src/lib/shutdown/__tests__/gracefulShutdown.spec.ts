import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http, { type Server } from 'http';
import type { AddressInfo } from 'net';
import type { ChildLogger, RootLogger } from '../../shared/logger';
import {
    setupGracefulShutdown,
    type CleanupFn,
    type GracefulShutdownOptions,
} from '../gracefulShutdown';
import { createShutdownState } from '../shutdownState';

const SIGNALS = ['SIGTERM', 'SIGINT', 'SIGQUIT'] as const;
type Signal = (typeof SIGNALS)[number];
type Listeners = ReturnType<typeof process.listeners>;

function createMockServer(close: (cb: (err?: Error) => void) => void = (cb) => cb()): Server {
    return {
        close: vi.fn(close),
        closeIdleConnections: vi.fn(),
    } as unknown as Server;
}

function createMockRootLogger(): RootLogger & { childLogger: ChildLogger } {
    const childLogger: ChildLogger = {
        info: vi.fn(),
        error: vi.fn(),
    };
    return { child: vi.fn(() => childLogger), childLogger };
}

function setup(
    server: Server,
    root: RootLogger,
    cleanups: CleanupFn[] = [],
    options: Partial<GracefulShutdownOptions> = {},
): void {
    setupGracefulShutdown(server, root, cleanups, {
        state: createShutdownState(),
        signals: ['SIGTERM', 'SIGINT'],
        ...options,
    });
}

describe('setupGracefulShutdown', () => {
    let before: Map<Signal, Listeners>;
    let exits: number[];
    let exited: Promise<number>;

    const added = (signal: Signal): Listeners =>
        process.listeners(signal).filter((listener) => !before.get(signal)?.includes(listener));

    beforeEach(() => {
        before = new Map(SIGNALS.map((s) => [s, process.listeners(s)]));
        exits = [];
        let firstExit = (_code: number): void => undefined;
        exited = new Promise((resolve) => (firstExit = resolve));
        vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
            exits.push(code);
            firstExit(code);
        }) as typeof process.exit);
    });

    afterEach(() => {
        for (const signal of SIGNALS) {
            for (const listener of added(signal)) {
                process.removeListener(signal, listener as () => void);
            }
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('registration', () => {
        it('listens to the signals given and no others, logging through the server/shutdown child', () => {
            const root = createMockRootLogger();

            setup(createMockServer(), root);

            expect(root.child).toHaveBeenCalledWith('server', 'shutdown');
            expect(added('SIGTERM')).toHaveLength(1);
            expect(added('SIGINT')).toHaveLength(1);
            expect(added('SIGQUIT')).toHaveLength(0);
        });

        it('shuts down on another signal given, listening once to one given twice', async () => {
            const server = createMockServer();
            setup(server, createMockRootLogger(), [], { signals: ['SIGQUIT', 'SIGQUIT'] });

            expect(added('SIGQUIT')).toHaveLength(1);
            expect(added('SIGTERM')).toHaveLength(0);
            process.emit('SIGQUIT', 'SIGQUIT');

            expect(await exited).toBe(0);
            expect(server.close).toHaveBeenCalledOnce();
        });
    });

    describe('the shutdown sequence', () => {
        it('on the first signal marks the state, runs onShutdownStart, closes the server, runs the cleanups in order and exits 0', async () => {
            const root = createMockRootLogger();
            const order: string[] = [];
            const state = createShutdownState();
            const server = createMockServer((cb) => {
                order.push(`close, shutting down: ${String(state.isShuttingDown())}`);
                cb();
            });
            setup(
                server,
                root,
                [
                    () => void order.push('cleanup 1'),
                    async () => {
                        await Promise.resolve();
                        order.push('cleanup 2');
                    },
                ],
                {
                    state,
                    onShutdownStart: async () => {
                        await Promise.resolve();
                        order.push('start');
                    },
                },
            );
            expect(state.isShuttingDown()).toBe(false);

            process.emit('SIGTERM', 'SIGTERM');

            expect(state.isShuttingDown()).toBe(true);
            expect(await exited).toBe(0);
            expect(order).toEqual([
                'start',
                'close, shutting down: true',
                'cleanup 1',
                'cleanup 2',
            ]);
            expect(root.childLogger.info).toHaveBeenNthCalledWith(
                1,
                'Received shutdown signal, closing server...',
                { signal: 'SIGTERM' },
            );
            expect(root.childLogger.info).toHaveBeenLastCalledWith('Graceful shutdown complete', {
                signal: 'SIGTERM',
            });
            expect(root.childLogger.error).not.toHaveBeenCalled();
        });

        it('starts the same way on SIGINT', async () => {
            const root = createMockRootLogger();
            const server = createMockServer();
            setup(server, root);

            process.emit('SIGINT', 'SIGINT');

            expect(await exited).toBe(0);
            expect(server.close).toHaveBeenCalledOnce();
            expect(root.childLogger.info).toHaveBeenCalledWith(
                'Received shutdown signal, closing server...',
                { signal: 'SIGINT' },
            );
        });

        it('still shuts down when the app marked the state itself beforehand', async () => {
            const state = createShutdownState();
            state.begin();
            const server = createMockServer();
            setup(server, createMockRootLogger(), [], { state });

            process.emit('SIGTERM', 'SIGTERM');

            expect(await exited).toBe(0);
            expect(server.close).toHaveBeenCalledOnce();
        });
    });

    describe('a failing step', () => {
        it('logs a failing onShutdownStart, still closes and cleans up, and exits 1', async () => {
            const root = createMockRootLogger();
            const server = createMockServer();
            const cleanup = vi.fn();
            setup(server, root, [cleanup], {
                onShutdownStart: () => {
                    throw new Error('deregistration failed');
                },
            });

            process.emit('SIGTERM', 'SIGTERM');

            expect(await exited).toBe(1);
            expect(root.childLogger.error).toHaveBeenCalledWith(
                'Error in onShutdownStart',
                new Error('deregistration failed'),
                { signal: 'SIGTERM' },
            );
            expect(server.close).toHaveBeenCalledOnce();
            expect(cleanup).toHaveBeenCalledOnce();
        });

        it('logs a server close error, still cleans up, and exits 1', async () => {
            const root = createMockRootLogger();
            const cleanup = vi.fn();
            setup(
                createMockServer((cb) => cb(new Error('close failed'))),
                root,
                [cleanup],
            );

            process.emit('SIGTERM', 'SIGTERM');

            expect(await exited).toBe(1);
            expect(root.childLogger.error).toHaveBeenCalledWith(
                'Error closing server',
                new Error('close failed'),
                { signal: 'SIGTERM' },
            );
            expect(cleanup).toHaveBeenCalledOnce();
        });

        it('logs each failing cleanup by name or position, still runs the rest, and exits 1', async () => {
            const root = createMockRootLogger();
            async function closeDb(): Promise<void> {
                await Promise.resolve();
                throw new Error('db close failed');
            }
            const last = vi.fn();
            setup(createMockServer(), root, [
                () => {
                    throw new Error('first failed');
                },
                closeDb,
                last,
            ]);

            process.emit('SIGTERM', 'SIGTERM');

            expect(await exited).toBe(1);
            expect(vi.mocked(root.childLogger.error).mock.calls).toEqual([
                [
                    'Error during resource cleanup',
                    new Error('first failed'),
                    { signal: 'SIGTERM', cleanup: '#1' },
                ],
                [
                    'Error during resource cleanup',
                    new Error('db close failed'),
                    { signal: 'SIGTERM', cleanup: 'closeDb' },
                ],
            ]);
            expect(last).toHaveBeenCalledOnce();
        });

        it('wraps a thrown value that is not an Error, keeping it as the cause', async () => {
            const root = createMockRootLogger();
            const reason = { code: 'E_PLAIN' };
            setup(createMockServer(), root, [], {
                onShutdownStart: () => {
                    // eslint-disable-next-line @typescript-eslint/only-throw-error -- callers can throw anything
                    throw reason;
                },
            });

            process.emit('SIGTERM', 'SIGTERM');

            expect(await exited).toBe(1);
            const [, error] = vi.mocked(root.childLogger.error).mock.calls[0]!;
            expect(error).toEqual(new Error('[object Object]'));
            expect(error.cause).toBe(reason);
        });

        it('still exits, with code 1, when the logger throws', async () => {
            const root = createMockRootLogger();
            vi.mocked(root.childLogger.info).mockImplementation(() => {
                throw new Error('logger broken');
            });
            setup(createMockServer(), root);

            process.emit('SIGTERM', 'SIGTERM');

            expect(await exited).toBe(1);
        });
    });

    describe('signals during shutdown', () => {
        it('ignores a repeated signal, logging it, and shuts down once', async () => {
            const root = createMockRootLogger();
            const server = createMockServer();
            const cleanup = vi.fn();
            setup(server, root, [cleanup]);

            process.emit('SIGTERM', 'SIGTERM');
            process.emit('SIGINT', 'SIGINT');
            process.emit('SIGTERM', 'SIGTERM');

            expect(await exited).toBe(0);
            expect(exits).toEqual([0]);
            expect(server.close).toHaveBeenCalledOnce();
            expect(cleanup).toHaveBeenCalledOnce();
            expect(root.childLogger.info).toHaveBeenCalledWith(
                'Shutdown already in progress, ignoring signal',
                { signal: 'SIGINT' },
            );
        });
    });

    describe('the exit', () => {
        it('lets a logger that can flush write out the last lines first', async () => {
            const order: string[] = [];
            const root = createMockRootLogger();
            vi.mocked(root.childLogger.info).mockImplementation((message) => order.push(message));
            root.flush = () => Promise.resolve(void order.push('flushed'));
            setup(createMockServer(), root);

            process.emit('SIGTERM', 'SIGTERM');

            expect(await exited).toBe(0);
            expect(order.slice(-2)).toEqual(['Graceful shutdown complete', 'flushed']);
        });
    });

    describe('the deadline', () => {
        it.each([
            [undefined, 30_000],
            [5_000, 5_000],
        ])('forces exit 1 when shutdown hangs, at forceExitMs %s', (forceExitMs, deadline) => {
            vi.useFakeTimers();
            const root = createMockRootLogger();
            setup(
                createMockServer(() => undefined),
                root,
                [],
                forceExitMs === undefined ? {} : { forceExitMs },
            );

            process.emit('SIGTERM', 'SIGTERM');
            vi.advanceTimersByTime(deadline - 1);
            expect(exits).toEqual([]);
            vi.advanceTimersByTime(1);

            expect(exits).toEqual([1]);
            expect(root.childLogger.error).toHaveBeenCalledWith(
                'Graceful shutdown timed out, forcing exit',
                new Error('Graceful shutdown timed out'),
                { signal: 'SIGTERM' },
            );
        });

        it('lets a logger that can flush write out the timeout line before the forced exit', async () => {
            vi.useFakeTimers();
            const root = createMockRootLogger();
            root.flush = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 200)));
            setup(
                createMockServer(() => undefined),
                root,
                [],
                { forceExitMs: 1_000 },
            );

            process.emit('SIGTERM', 'SIGTERM');
            await vi.advanceTimersByTimeAsync(1_000);
            expect(root.flush).toHaveBeenCalledOnce();
            expect(exits).toEqual([]);
            await vi.advanceTimersByTimeAsync(200);

            expect(exits).toEqual([1]);
        });

        it('cancels the forced exit once shutdown completes', async () => {
            vi.useFakeTimers();
            setup(createMockServer(), createMockRootLogger());

            process.emit('SIGTERM', 'SIGTERM');
            expect(await exited).toBe(0);
            vi.advanceTimersByTime(60_000);

            expect(exits).toEqual([0]);
        });
    });

    describe('open connections', () => {
        it('closes idle connections every second until the server has closed', async () => {
            vi.useFakeTimers();
            let closed = (): void => undefined;
            const server = createMockServer((cb) => (closed = () => cb()));
            setup(server, createMockRootLogger());

            process.emit('SIGTERM', 'SIGTERM');
            await vi.advanceTimersByTimeAsync(3_000);
            expect(server.closeIdleConnections).toHaveBeenCalledTimes(3);
            closed();
            await vi.advanceTimersByTimeAsync(3_000);

            expect(server.closeIdleConnections).toHaveBeenCalledTimes(3);
        });

        it('closes a keep-alive connection whose response finishes after the signal, long before the keep-alive timeout', async () => {
            let release = (): void => undefined;
            const released = new Promise<void>((resolve) => (release = resolve));
            let arrived = (): void => undefined;
            const hasArrived = new Promise<void>((resolve) => (arrived = resolve));
            const server = http.createServer((_req, res) => {
                arrived();
                void released.then(() => res.end('done'));
            });
            server.keepAliveTimeout = 65_000;
            await new Promise<void>((resolve) => server.listen(0, resolve));
            const { port } = server.address() as AddressInfo;
            const cleanup = vi.fn();
            setup(server, createMockRootLogger(), [cleanup], {
                forceExitMs: 10_000,
            });
            const agent = new http.Agent({ keepAlive: true });
            try {
                const body = new Promise<string>((resolve, reject) => {
                    http.get({ port, agent }, (res) => {
                        let text = '';
                        res.setEncoding('utf8');
                        res.on('data', (chunk: string) => (text += chunk));
                        res.on('end', () => resolve(text));
                    }).on('error', reject);
                });
                await hasArrived;

                process.emit('SIGTERM', 'SIGTERM');
                const signalledAt = Date.now();
                release();

                expect(await body).toBe('done');
                expect(await exited).toBe(0);
                expect(cleanup).toHaveBeenCalledOnce();
                expect(Date.now() - signalledAt).toBeLessThan(3_000);
            } finally {
                release();
                agent.destroy();
                server.closeAllConnections();
            }
        }, 10_000);
    });
});
