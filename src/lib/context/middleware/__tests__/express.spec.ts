import { describe, it, expect, vi } from 'vitest';
import { createExpressMiddleware } from '../express';
import { getStore, getRequestId } from '../../store';
import { ORG_ID_HEADER, REQUEST_ID_HEADER } from '../../headers';
import { MISSING_ORG_ERROR, MISSING_REQUEST_ID_WARN } from '../resolveContext';

const makeReq = (headers: Record<string, string> = {}) => ({
    headers: { 'user-agent': 'agent/1', ...headers },
    url: '/orders',
    originalUrl: '/api/orders',
    method: 'POST',
});
const makeRes = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
});
const makeLogger = () => ({ warn: vi.fn(), error: vi.fn() });
const BOTH_HEADERS = {
    [ORG_ID_HEADER]: 'org-1',
    [REQUEST_ID_HEADER]: 'corr-1',
};

describe('createExpressMiddleware', () => {
    it('runs next inside a context built from the request headers, logging nothing', () => {
        const logger = makeLogger();
        const next = vi.fn(() => {
            expect(getStore()).toEqual({
                orgId: 'org-1',
                requestId: 'corr-1',
            });
        });

        createExpressMiddleware({ logger })(makeReq(BOTH_HEADERS), makeRes(), next);

        expect(next).toHaveBeenCalledOnce();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('keeps the context for async work started in next', async () => {
        let work: Promise<string> | undefined;

        createExpressMiddleware()(makeReq(BOTH_HEADERS), makeRes(), () => {
            work = new Promise((resolve) => setTimeout(resolve, 1)).then(
                () => getStore()?.orgId ?? 'none',
            );
        });

        await expect(work).resolves.toBe('org-1');
    });

    it('generates a request ID when the header is missing, and warns with the request details', () => {
        const logger = makeLogger();
        const next = vi.fn(() => {
            expect(getRequestId()).toMatch(/^[0-9a-f-]{36}$/);
        });

        createExpressMiddleware({ logger })(
            makeReq({ [ORG_ID_HEADER]: 'org-1' }),
            makeRes(),
            next,
        );

        expect(next).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledWith(MISSING_REQUEST_ID_WARN, {
            method: 'POST',
            path: '/api/orders',
            orgId: 'org-1',
            requestId: undefined,
            userAgent: 'agent/1',
        });
    });

    it('rejects a request without an org ID with 400, logging it and never calling next', () => {
        const logger = makeLogger();
        const res = makeRes();
        const next = vi.fn();

        createExpressMiddleware({ logger })(
            makeReq({ [REQUEST_ID_HEADER]: 'corr-1' }),
            res,
            next,
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: MISSING_ORG_ERROR });
        expect(next).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(
            MISSING_ORG_ERROR,
            new Error(MISSING_ORG_ERROR),
            {
                method: 'POST',
                path: '/api/orders',
                orgId: undefined,
                requestId: 'corr-1',
                userAgent: 'agent/1',
            },
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('also warns about a missing request ID when it rejects, so both problems are logged at once', () => {
        const logger = makeLogger();

        createExpressMiddleware({ logger })(makeReq(), makeRes(), vi.fn());

        expect(logger.warn).toHaveBeenCalledWith(
            MISSING_REQUEST_ID_WARN,
            expect.any(Object),
        );
        expect(logger.error).toHaveBeenCalledOnce();
    });

    it('runs under the default org in single-tenant mode, whatever the header says', () => {
        const res = makeRes();
        const next = vi.fn(() => {
            expect(getStore()?.orgId).toBe('default-org');
        });

        createExpressMiddleware({ getDefaultOrgId: () => 'default-org' })(
            makeReq({ ...BOTH_HEADERS, [ORG_ID_HEADER]: 'other-org' }),
            res,
            next,
        );

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('logs the full path, not the one relative to the router it is mounted on', () => {
        const logger = makeLogger();

        createExpressMiddleware({ logger })(makeReq(), makeRes(), vi.fn());

        expect(logger.error).toHaveBeenCalledWith(
            MISSING_ORG_ERROR,
            expect.any(Error),
            expect.objectContaining({ path: '/api/orders' }),
        );
    });

    it('rejects without a logger', () => {
        const res = makeRes();

        createExpressMiddleware()(makeReq(), res, vi.fn());

        expect(res.status).toHaveBeenCalledWith(400);
    });
});
