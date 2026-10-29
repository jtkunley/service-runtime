import { describe, it, expect, vi } from 'vitest';
import { createExpressMiddleware } from '../express';
import { getStore, getRequestId } from '../store';
import { ORG_ID_HEADER, REQUEST_ID_HEADER } from '../headers';

const makeReq = (headers: Record<string, string> = {}) => ({
    headers,
    method: 'POST',
    url: '/orders',
    originalUrl: '/api/orders',
});
const makeRes = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
});

describe('createExpressMiddleware', () => {
    it('runs next inside the context taken from the request headers', () => {
        const next = vi.fn(() => {
            expect(getStore()).toEqual({ orgId: 'org-1', requestId: 'req-1' });
        });

        createExpressMiddleware()(
            makeReq({ [ORG_ID_HEADER]: 'org-1', [REQUEST_ID_HEADER]: 'req-1' }),
            makeRes(),
            next,
        );

        expect(next).toHaveBeenCalledOnce();
    });

    it('generates a request ID when the request has none', () => {
        const next = vi.fn(() => {
            expect(getRequestId()).toMatch(/^[0-9a-f-]{36}$/);
        });

        createExpressMiddleware()(makeReq({ [ORG_ID_HEADER]: 'org-1' }), makeRes(), next);

        expect(next).toHaveBeenCalledOnce();
    });

    it('keeps the context for async work started in next', async () => {
        let work: Promise<string> | undefined;

        createExpressMiddleware()(makeReq({ [ORG_ID_HEADER]: 'org-1' }), makeRes(), () => {
            work = new Promise((resolve) => setTimeout(resolve, 1)).then(
                () => getStore()?.orgId ?? 'none',
            );
        });

        await expect(work).resolves.toBe('org-1');
    });

    it('answers 400 with the error, never calling next, when the org ID is missing', () => {
        const res = makeRes();
        const next = vi.fn();

        createExpressMiddleware()(makeReq(), res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Missing required header: x-org-id',
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('logs the full path, not the one relative to the router it is mounted on', () => {
        const logger = { warn: vi.fn(), error: vi.fn() };

        createExpressMiddleware({ logger })(makeReq(), makeRes(), vi.fn());

        expect(logger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Error),
            expect.objectContaining({ method: 'POST', path: '/api/orders' }),
        );
    });

    it('passes its options on, running under the default org in single-tenant mode', () => {
        const next = vi.fn(() => {
            expect(getStore()?.orgId).toBe('default-org');
        });

        createExpressMiddleware({ getDefaultOrgId: () => 'default-org' })(
            makeReq({ [ORG_ID_HEADER]: 'other-org' }),
            makeRes(),
            next,
        );

        expect(next).toHaveBeenCalledOnce();
    });
});
