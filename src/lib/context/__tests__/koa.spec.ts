import { describe, it, expect, vi } from 'vitest';
import { createKoaMiddleware } from '../koa';
import { getStore, getRequestId } from '../store';
import { ORG_ID_HEADER, REQUEST_ID_HEADER } from '../headers';

const makeCtx = (headers: Record<string, string> = {}) => ({
    headers,
    method: 'POST',
    url: '/orders',
    status: 404,
    body: undefined as unknown,
});

describe('createKoaMiddleware', () => {
    it('runs next inside the context taken from the request headers', async () => {
        const next = vi.fn(() => {
            expect(getStore()).toEqual({ orgId: 'org-1', requestId: 'req-1' });
            return Promise.resolve();
        });

        await createKoaMiddleware()(
            makeCtx({ [ORG_ID_HEADER]: 'org-1', [REQUEST_ID_HEADER]: 'req-1' }),
            next,
        );

        expect(next).toHaveBeenCalledOnce();
    });

    it('generates a request ID when the request has none', async () => {
        const next = vi.fn(() => {
            expect(getRequestId()).toMatch(/^[0-9a-f-]{36}$/);
            return Promise.resolve();
        });

        await createKoaMiddleware()(makeCtx({ [ORG_ID_HEADER]: 'org-1' }), next);

        expect(next).toHaveBeenCalledOnce();
    });

    it('resolves only once downstream middleware has finished, with the context set throughout', async () => {
        const order: string[] = [];

        await createKoaMiddleware()(makeCtx({ [ORG_ID_HEADER]: 'org-1' }), async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            order.push(`downstream ${getStore()?.orgId ?? 'none'}`);
        });
        order.push('resolved');

        expect(order).toEqual(['downstream org-1', 'resolved']);
    });

    it('passes a downstream error on', async () => {
        await expect(
            createKoaMiddleware()(makeCtx({ [ORG_ID_HEADER]: 'org-1' }), () =>
                Promise.reject(new Error('downstream failed')),
            ),
        ).rejects.toThrow('downstream failed');
    });

    it('answers 400 with the error, never calling next, when the org ID is missing', async () => {
        const ctx = makeCtx();
        const next = vi.fn(() => Promise.resolve());

        await createKoaMiddleware()(ctx, next);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({ error: 'Missing required header: x-org-id' });
        expect(next).not.toHaveBeenCalled();
    });

    it('logs the request path', async () => {
        const logger = { warn: vi.fn(), error: vi.fn() };

        await createKoaMiddleware({ logger })(makeCtx(), () => Promise.resolve());

        expect(logger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Error),
            expect.objectContaining({ method: 'POST', path: '/orders' }),
        );
    });

    it('passes its options on, running under the default org in single-tenant mode', async () => {
        const next = vi.fn(() => {
            expect(getStore()?.orgId).toBe('default-org');
            return Promise.resolve();
        });

        await createKoaMiddleware({ getDefaultOrgId: () => 'default-org' })(
            makeCtx({ [ORG_ID_HEADER]: 'other-org' }),
            next,
        );

        expect(next).toHaveBeenCalledOnce();
    });
});
