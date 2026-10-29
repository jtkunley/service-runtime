import { randomUUID } from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExpressMiddleware } from '../express';
import { configureContext } from '../../context/configureContext';

const context = configureContext({
    tenantId: { value: (req) => req.headers['x-tenant-id'], required: true },
    requestId: { value: (req) => req.headers['x-request-id'] ?? randomUUID() },
});

const servers: Server[] = [];

async function serve(
    listener: (req: IncomingMessage, res: ServerResponse) => unknown,
): Promise<string> {
    const server = createServer((req, res) => void listener(req, res));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
    logger.error.mockClear();
});

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
    res.json(context.getStore() ?? null);
};

const logger = { error: vi.fn() };

async function echoApp() {
    const app = express();
    app.use(createExpressMiddleware(context, logger));
    app.get('/context', echoContext);
    return serve(app);
}

describe('createExpressMiddleware in a real Express app', () => {
    it('hands the route the context taken from the request headers, whatever their case', async () => {
        const url = await echoApp();

        const res = await fetch(`${url}/context`, {
            headers: { 'X-Tenant-Id': 'tenant-1', 'X-Request-Id': 'req-1' },
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ tenantId: 'tenant-1', requestId: 'req-1' });
    });

    it('generates a request ID when the request has none', async () => {
        const url = await echoApp();

        const res = await fetch(`${url}/context`, { headers: { 'x-tenant-id': 'tenant-1' } });

        expect(await res.json()).toEqual({
            tenantId: 'tenant-1',
            requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        });
    });

    it('keeps the context through body parsing, a mounted router and async work in the handler', async () => {
        const router = express.Router();
        router.post('/orders', async (req, res) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            res.json({ body: req.body as unknown, tenantId: context.getStore()?.tenantId });
        });
        const app = express();
        app.use(createExpressMiddleware(context, logger));
        app.use(express.json());
        app.use('/api', router);
        const url = await serve(app);

        const res = await fetch(`${url}/api/orders`, {
            method: 'POST',
            headers: { 'x-tenant-id': 'tenant-1', 'content-type': 'application/json' },
            body: JSON.stringify({ item: 'book' }),
        });

        expect(await res.json()).toEqual({ body: { item: 'book' }, tenantId: 'tenant-1' });
    });

    it('keeps concurrent requests apart', async () => {
        const app = express();
        app.use(createExpressMiddleware(context, logger));
        app.get('/context', async (_req, res) => {
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
            res.json(context.getStore() ?? null);
        });
        const url = await serve(app);
        const tenantIds = Array.from({ length: 20 }, (_, i) => `tenant-${i}`);

        const seen = await Promise.all(
            tenantIds.map(async (tenantId) => {
                const res = await fetch(`${url}/context`, {
                    headers: { 'x-tenant-id': tenantId, 'x-request-id': `req-${tenantId}` },
                });
                return res.json();
            }),
        );

        expect(seen).toEqual(
            tenantIds.map((tenantId) => ({ tenantId, requestId: `req-${tenantId}` })),
        );
    });

    it('answers 400 with the error as JSON, never reaching the route, when the tenant ID is missing', async () => {
        const route = vi.fn(echoContext);
        const app = express();
        app.use(createExpressMiddleware(context, logger));
        app.get('/context', route);
        const url = await serve(app);

        const res = await fetch(`${url}/context`);

        expect(res.status).toBe(400);
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
        expect(await res.json()).toEqual({ error: 'Missing required context value: tenantId' });
        expect(route).not.toHaveBeenCalled();
    });

    it('logs the full path when mounted on a router, without the query string', async () => {
        const router = express.Router();
        router.use(createExpressMiddleware(context, logger));
        const app = express();
        app.use('/api', router);
        const url = await serve(app);

        await fetch(`${url}/api/orders?token=secret`, { method: 'POST' });

        expect(logger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Error),
            expect.objectContaining({ method: 'POST', path: '/api/orders' }),
        );
    });
});
