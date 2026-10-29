import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { describe, it, expect, vi, beforeEach, afterEach, expectTypeOf } from 'vitest';
import type { ChildLogger, RootLogger } from '../../shared/logger';
import type { GracefulShutdownOptions } from '../../shutdown/gracefulShutdown';

const mocks = vi.hoisted(() => ({
    registerFatalHandlers: vi.fn(),
    setupGracefulShutdown: vi.fn(),
}));
vi.mock('../../fatal/fatalHandlers', () => ({
    registerFatalHandlers: mocks.registerFatalHandlers,
}));
vi.mock('../../shutdown/gracefulShutdown', () => ({
    setupGracefulShutdown: mocks.setupGracefulShutdown,
}));

const CONTEXT = {
    tenantId: {
        value: (req: { headers: Readonly<Record<string, string | undefined>> }) =>
            req.headers['x-tenant-id'],
        required: true,
        header: 'x-tenant-id',
    },
    requestId: {
        value: () => 'req-1',
        header: 'x-request-id',
    },
} as const;
const DESTINATIONS = { internal: ['tenantId', 'requestId'], payments: ['requestId'] } as const;

function createMockRootLogger(): RootLogger & { childLogger: ChildLogger } {
    const childLogger: ChildLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { child: vi.fn(() => childLogger), childLogger };
}

/** The server and options `listen` handed to graceful shutdown. */
const shutdownCall = () =>
    mocks.setupGracefulShutdown.mock.calls[0] as [
        Server,
        RootLogger,
        (() => void)[],
        GracefulShutdownOptions,
    ];

describe('configureService', () => {
    let configureService: typeof import('../configureService.js').configureService;
    const servers: Server[] = [];

    const configure = (logger: RootLogger = createMockRootLogger()) =>
        configureService({ logger, context: CONTEXT, destinations: DESTINATIONS });

    /** Listens on a free port, returning the base URL and the server for cleanup. */
    const listen = async (
        service: ReturnType<typeof configure>,
        app = vi.fn((_req: unknown, res: { end(body: string): void }) => res.end('app')),
        options: Partial<Parameters<typeof service.listen>[1]> = {},
    ) => {
        const { port } = await service.listen(app, { port: 0, host: '127.0.0.1', ...options });
        servers.push(shutdownCall()[0]);
        return { url: `http://127.0.0.1:${String(port)}`, app };
    };

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        configureService = (await import('../configureService.js')).configureService;
    });

    afterEach(async () => {
        await Promise.all(
            servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
        );
        vi.restoreAllMocks();
    });

    describe('configuring', () => {
        it('touches nothing process-wide until listen', () => {
            configure();
            configure();

            expect(mocks.registerFatalHandlers).not.toHaveBeenCalled();
            expect(mocks.setupGracefulShutdown).not.toHaveBeenCalled();
        });

        it('types the context values from the entries', () => {
            const service = configure();

            service.context.run({ headers: { 'x-tenant-id': 'tenant-1' } }, () => {
                expectTypeOf(service.context.get('tenantId')).toEqualTypeOf<string>();
                expectTypeOf(service.context.get('requestId')).toEqualTypeOf<string | undefined>();
                expect(service.context.getStore()).toEqual({
                    tenantId: 'tenant-1',
                    requestId: 'req-1',
                });
            });
        });

        it('makes an attribute ContextEntry does not have a compile error', () => {
            configureService({
                logger: createMockRootLogger(),
                // @ts-expect-error -- a misspelt attribute would otherwise be ignored silently
                context: { entry: { value: () => 'v', requried: true } },
            });
        });
    });

    describe('middleware', () => {
        const res = () => {
            const json = vi.fn();
            return { status: vi.fn(() => ({ json })), json };
        };

        it('runs the rest of the request inside its context', () => {
            const service = configure();
            let seen: unknown;

            service.middleware(
                { headers: { 'x-tenant-id': 'tenant-1' }, method: 'GET', originalUrl: '/orders' },
                res(),
                () => (seen = service.context.getStore()),
            );

            expect(seen).toEqual({ tenantId: 'tenant-1', requestId: 'req-1' });
        });

        it('answers 400 to a request missing a required value, logging through server/context', () => {
            const logger = createMockRootLogger();
            const service = configure(logger);
            const response = res();
            const next = vi.fn();

            service.middleware(
                { headers: {}, method: 'GET', originalUrl: '/orders' },
                response,
                next,
            );

            expect(next).not.toHaveBeenCalled();
            expect(response.status).toHaveBeenCalledWith(400);
            expect(logger.child).toHaveBeenCalledWith('server', 'context');
            expect(logger.childLogger.error).toHaveBeenCalledOnce();
        });
    });

    describe('getHeaders', () => {
        it('returns the headers each declared destination receives, in a request', () => {
            const service = configure();

            service.context.run({ headers: { 'x-tenant-id': 'tenant-1' } }, () => {
                expect(service.context.getHeaders('internal')).toEqual({
                    'x-tenant-id': 'tenant-1',
                    'x-request-id': 'req-1',
                });
                expect(service.context.getHeaders('payments')).toEqual({ 'x-request-id': 'req-1' });
            });
        });

        it('accepts only declared destinations', () => {
            const service = configure();

            // @ts-expect-error -- billing was never declared
            expect(() => service.context.getHeaders('billing')).toThrow('Unknown destination');
        });

        it('has no destinations when none are declared', () => {
            const service = configureService({ logger: createMockRootLogger(), context: CONTEXT });

            // @ts-expect-error -- nothing was declared
            expect(() => service.context.getHeaders('internal')).toThrow('Unknown destination');
        });
    });

    describe('listen', () => {
        it('registers the fatal handlers, then starts the server and hands it, with the cleanups and the shutdown state, to graceful shutdown', async () => {
            const logger = createMockRootLogger();
            const service = configure(logger);
            const first = vi.fn();
            const onShutdownStart = vi.fn();
            service.onShutdown(first);

            const { url } = await listen(service, undefined, {
                forceExitMs: 5_000,
                onShutdownStart,
            });
            const later = vi.fn();
            service.onShutdown(later);

            expect(mocks.registerFatalHandlers).toHaveBeenCalledWith(logger);
            expect(mocks.registerFatalHandlers.mock.invocationCallOrder[0]).toBeLessThan(
                mocks.setupGracefulShutdown.mock.invocationCallOrder[0]!,
            );
            const [server, shutdownLogger, cleanups, options] = shutdownCall();
            expect(server.listening).toBe(true);
            expect(shutdownLogger).toBe(logger);
            expect(cleanups).toEqual([first, later]);
            expect(options).toMatchObject({ forceExitMs: 5_000, onShutdownStart });
            expect(await (await fetch(`${url}/orders`)).text()).toBe('app');
        });

        it('resolves with the address it bound', async () => {
            const service = configure();

            const address = await service.listen(vi.fn(), { port: 0, host: '127.0.0.1' });
            servers.push(shutdownCall()[0]);

            expect(address).toEqual(shutdownCall()[0].address());
        });

        it('lets only one service in the process listen', async () => {
            const service = configure();
            await listen(service);

            for (const second of [service, configure()]) {
                await expect(second.listen(vi.fn(), { port: 0 })).rejects.toThrow(
                    'Only one service can listen per process',
                );
            }
            expect(mocks.registerFatalHandlers).toHaveBeenCalledOnce();
        });

        it('rejects when the port is taken', async () => {
            const taken = createServer();
            await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
            servers.push(taken);
            const service = configure();

            await expect(
                service.listen(vi.fn(), {
                    port: (taken.address() as AddressInfo).port,
                    host: '127.0.0.1',
                }),
            ).rejects.toThrow(expect.objectContaining({ code: 'EADDRINUSE' }) as Error);
        });
    });

    describe('health probes', () => {
        it('answers readiness 200, then 503 once shutdown starts, without reaching the app', async () => {
            const service = configure();
            const { url, app } = await listen(service);

            expect((await fetch(`${url}/readiness`)).status).toBe(200);
            shutdownCall()[3].state?.begin();

            expect(service.isShuttingDown()).toBe(true);
            expect((await fetch(`${url}/readiness?probe=k8s`)).status).toBe(503);
            expect(app).not.toHaveBeenCalled();
        });

        it('answers liveness 200, even while shutting down', async () => {
            const service = configure();
            const { url, app } = await listen(service);
            shutdownCall()[3].state?.begin();

            expect((await fetch(`${url}/liveness`, { method: 'HEAD' })).status).toBe(200);
            expect(app).not.toHaveBeenCalled();
        });

        it('leaves other methods on the probe paths to the app', async () => {
            const { url, app } = await listen(configure());

            await fetch(`${url}/readiness`, { method: 'POST' });

            expect(app).toHaveBeenCalledOnce();
        });

        it('keeps the default path for a probe given as undefined', async () => {
            const { url, app } = await listen(configure(), undefined, {
                probes: { readiness: undefined, liveness: undefined },
            });

            expect((await fetch(`${url}/readiness`)).status).toBe(200);
            expect((await fetch(`${url}/liveness`)).status).toBe(200);
            expect(app).not.toHaveBeenCalled();
        });

        it('serves probes on the paths given, and none where turned off', async () => {
            const { url, app } = await listen(configure(), undefined, {
                probes: { readiness: '/ready', liveness: false },
            });

            expect((await fetch(`${url}/ready`)).status).toBe(200);
            expect(await (await fetch(`${url}/liveness`)).text()).toBe('app');
            expect(await (await fetch(`${url}/readiness`)).text()).toBe('app');
            expect(app).toHaveBeenCalledTimes(2);
        });
    });
});
