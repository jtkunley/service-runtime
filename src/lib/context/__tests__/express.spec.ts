import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExpressMiddleware } from '../express';
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

const echoContext: express.RequestHandler = (_req, res) => {
    res.json(getStore() ?? null);
};

async function echoApp(opts?: Parameters<typeof createExpressMiddleware>[0]) {
    const app = express();
    app.use(createExpressMiddleware(opts));
    app.get('/context', echoContext);
    return serve(app);
}

describe('createExpressMiddleware in a real Express app', () => {
    it('hands the route the context taken from the request headers, whatever their case', async () => {
        const url = await echoApp();

        const res = await fetch(`${url}/context`, {
            headers: { 'X-Org-Id': 'org-1', 'X-Request-Id': 'req-1' },
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ orgId: 'org-1', requestId: 'req-1' });
    });

    it('generates a request ID when the request has none', async () => {
        const url = await echoApp();

        const res = await fetch(`${url}/context`, { headers: { [ORG_ID_HEADER]: 'org-1' } });

        expect(await res.json()).toEqual({
            orgId: 'org-1',
            requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        });
    });

    it('keeps the context through body parsing, a mounted router and async work in the handler', async () => {
        const router = express.Router();
        router.post('/orders', async (req, res) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            res.json({ body: req.body as unknown, orgId: getStore()?.orgId });
        });
        const app = express();
        app.use(createExpressMiddleware());
        app.use(express.json());
        app.use('/api', router);
        const url = await serve(app);

        const res = await fetch(`${url}/api/orders`, {
            method: 'POST',
            headers: { [ORG_ID_HEADER]: 'org-1', 'content-type': 'application/json' },
            body: JSON.stringify({ item: 'book' }),
        });

        expect(await res.json()).toEqual({ body: { item: 'book' }, orgId: 'org-1' });
    });

    it('keeps concurrent requests apart', async () => {
        const app = express();
        app.use(createExpressMiddleware());
        app.get('/context', async (_req, res) => {
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
            res.json(getStore() ?? null);
        });
        const url = await serve(app);
        const orgIds = Array.from({ length: 20 }, (_, i) => `org-${i}`);

        const seen = await Promise.all(
            orgIds.map(async (orgId) => {
                const res = await fetch(`${url}/context`, {
                    headers: { [ORG_ID_HEADER]: orgId, [REQUEST_ID_HEADER]: `req-${orgId}` },
                });
                return res.json();
            }),
        );

        expect(seen).toEqual(orgIds.map((orgId) => ({ orgId, requestId: `req-${orgId}` })));
    });

    it('answers 400 with the error as JSON, never reaching the route, when the org ID is missing', async () => {
        const route = vi.fn(echoContext);
        const app = express();
        app.use(createExpressMiddleware());
        app.get('/context', route);
        const url = await serve(app);

        const res = await fetch(`${url}/context`);

        expect(res.status).toBe(400);
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
        expect(await res.json()).toEqual({ error: 'Missing required header: x-org-id' });
        expect(route).not.toHaveBeenCalled();
    });

    it('logs the full path when mounted on a router', async () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const router = express.Router();
        router.use(createExpressMiddleware({ logger }));
        const app = express();
        app.use('/api', router);
        const url = await serve(app);

        await fetch(`${url}/api/orders`, { method: 'POST' });

        expect(logger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Error),
            expect.objectContaining({ method: 'POST', path: '/api/orders' }),
        );
    });

    it('runs under the default org in single-tenant mode, whatever the request says', async () => {
        const url = await echoApp({ getDefaultOrgId: () => 'default-org' });

        const res = await fetch(`${url}/context`, { headers: { [ORG_ID_HEADER]: 'other-org' } });

        expect(await res.json()).toMatchObject({ orgId: 'default-org' });
    });

});
