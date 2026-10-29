import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExpressMiddleware } from '../express';
import { getStore, getCorrelationId, _resetForTesting } from '../../store';
import { ORGANIZATION_ID_HEADER, CORRELATION_ID_HEADER } from '../../headers';
import { MISSING_ORG_ERROR, MISSING_CORRELATION_WARN } from '../resolveContext';

const makeReq = (headers: Record<string, string> = {}) => ({
    headers: { 'user-agent': 'agent/1', ...headers },
    url: '/orders',
    method: 'POST',
});
const makeRes = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
});
const makeLogger = () => ({ warn: vi.fn(), error: vi.fn() });
const BOTH_HEADERS = {
    [ORGANIZATION_ID_HEADER]: 'org-1',
    [CORRELATION_ID_HEADER]: 'corr-1',
};

beforeEach(() => _resetForTesting());

describe('createExpressMiddleware', () => {
    it('runs next inside a context built from the request headers, logging nothing', () => {
        const logger = makeLogger();
        const next = vi.fn(() => {
            expect(getStore()).toEqual({
                organizationId: 'org-1',
                correlationId: 'corr-1',
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
                () => getStore()?.organizationId ?? 'none',
            );
        });

        await expect(work).resolves.toBe('org-1');
    });

    it('generates a correlation ID when the header is missing, and warns with the request details', () => {
        const logger = makeLogger();
        const next = vi.fn(() => {
            expect(getCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
        });

        createExpressMiddleware({ logger })(
            makeReq({ [ORGANIZATION_ID_HEADER]: 'org-1' }),
            makeRes(),
            next,
        );

        expect(next).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledWith(MISSING_CORRELATION_WARN, {
            method: 'POST',
            path: '/orders',
            organizationId: 'org-1',
            correlationId: undefined,
            userAgent: 'agent/1',
        });
    });

    it('rejects a request without an organization ID with 400, logging it and never calling next', () => {
        const logger = makeLogger();
        const res = makeRes();
        const next = vi.fn();

        createExpressMiddleware({ logger })(
            makeReq({ [CORRELATION_ID_HEADER]: 'corr-1' }),
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
                path: '/orders',
                organizationId: undefined,
                correlationId: 'corr-1',
                userAgent: 'agent/1',
            },
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('also warns about a missing correlation ID when it rejects, so both problems are logged at once', () => {
        const logger = makeLogger();

        createExpressMiddleware({ logger })(makeReq(), makeRes(), vi.fn());

        expect(logger.warn).toHaveBeenCalledWith(
            MISSING_CORRELATION_WARN,
            expect.any(Object),
        );
        expect(logger.error).toHaveBeenCalledOnce();
    });

    it('runs under the default organization in single-tenant mode, whatever the header says', () => {
        const res = makeRes();
        const next = vi.fn(() => {
            expect(getStore()?.organizationId).toBe('default-org');
        });

        createExpressMiddleware({ getDefaultOrgId: () => 'default-org' })(
            makeReq({ ...BOTH_HEADERS, [ORGANIZATION_ID_HEADER]: 'other-org' }),
            res,
            next,
        );

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('rejects without a logger', () => {
        const res = makeRes();

        createExpressMiddleware()(makeReq(), res, vi.fn());

        expect(res.status).toHaveBeenCalledWith(400);
    });
});
