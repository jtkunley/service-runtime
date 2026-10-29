import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import Koa from 'koa';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKoaMiddleware } from '../koa';
import { getStore } from '../store';
import { ORG_ID_HEADER, REQUEST_ID_HEADER } from '../headers';

const servers: Server[] = [];

async function serve(
    listener: (req: IncomingMessage, res: ServerResponse) => unknown,
): Promise<string> {
    const server = createServer((req, res) => void listener(req, res));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(
            (server) =>
                new Promise((resolve) => {
                    server.close(resolve);
                    server.closeAllConnections();
                }),
        ),
    );
});

const echoContext: Koa.Middleware = (ctx) => {
    ctx.body = getStore() ?? null;
};

async function serveApp(
    route: Koa.Middleware,
    opts?: Parameters<typeof createKoaMiddleware>[0],
): Promise<string> {
    const app = new Koa();
    app.use(createKoaMiddleware(opts));
    app.use(route);
    return serve(app.callback());
}

describe('createKoaMiddleware in a real Koa app', () => {
    it('hands downstream middleware the context taken from the request headers, whatever their case', async () => {
        const url = await serveApp(echoContext);

        const res = await fetch(url, {
            headers: { 'X-Org-Id': 'org-1', 'X-Request-Id': 'req-1' },
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ orgId: 'org-1', requestId: 'req-1' });
    });

    it('generates a request ID when the request has none', async () => {
        const url = await serveApp(echoContext);

        const res = await fetch(url, { headers: { [ORG_ID_HEADER]: 'org-1' } });

        expect(await res.json()).toEqual({
            orgId: 'org-1',
            requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        });
    });

    it('keeps the context down the middleware chain and across async work', async () => {
        const app = new Koa();
        app.use(async (ctx, next) => {
            await next();
            ctx.body = { ...(ctx.body as object), afterDownstream: getStore()?.orgId ?? null };
        });
        app.use(createKoaMiddleware());
        app.use(async (ctx) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            ctx.body = { downstream: getStore()?.orgId };
        });
        const url = await serve(app.callback());

        const res = await fetch(url, { headers: { [ORG_ID_HEADER]: 'org-1' } });

        // Middleware registered before this one runs outside the context.
        expect(await res.json()).toEqual({ downstream: 'org-1', afterDownstream: null });
    });

    it('keeps concurrent requests apart', async () => {
        const url = await serveApp(async (ctx) => {
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
            ctx.body = getStore() ?? null;
        });
        const orgIds = Array.from({ length: 20 }, (_, i) => `org-${i}`);

        const seen = await Promise.all(
            orgIds.map(async (orgId) => {
                const res = await fetch(url, {
                    headers: { [ORG_ID_HEADER]: orgId, [REQUEST_ID_HEADER]: `req-${orgId}` },
                });
                return res.json();
            }),
        );

        expect(seen).toEqual(orgIds.map((orgId) => ({ orgId, requestId: `req-${orgId}` })));
    });

    it('answers 400 with the error as JSON, never reaching downstream, when the org ID is missing', async () => {
        const route = vi.fn(echoContext);
        const url = await serveApp(route);

        const res = await fetch(url);

        expect(res.status).toBe(400);
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
        expect(await res.json()).toEqual({ error: 'Missing required header: x-org-id' });
        expect(route).not.toHaveBeenCalled();
    });

    it("leaves a downstream error to Koa's error handling", async () => {
        const app = new Koa();
        const onError = vi.fn();
        app.silent = true;
        app.on('error', onError);
        app.use(createKoaMiddleware());
        app.use(() => Promise.reject(new Error('downstream failed')));
        const url = await serve(app.callback());

        const res = await fetch(url, { headers: { [ORG_ID_HEADER]: 'org-1' } });

        expect(res.status).toBe(500);
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'downstream failed' }),
            expect.anything(),
        );
    });

    it('logs the request path', async () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const url = await serveApp(echoContext, { logger });

        await fetch(`${url}/orders`, { method: 'POST' });

        expect(logger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Error),
            expect.objectContaining({ method: 'POST', path: '/orders' }),
        );
    });

    it('runs under the default org in single-tenant mode, whatever the request says', async () => {
        const url = await serveApp(echoContext, { getDefaultOrgId: () => 'default-org' });

        const res = await fetch(url, { headers: { [ORG_ID_HEADER]: 'other-org' } });

        expect(await res.json()).toMatchObject({ orgId: 'default-org' });
    });
});
