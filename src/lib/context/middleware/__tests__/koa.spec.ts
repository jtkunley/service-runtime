import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKoaMiddleware } from '../koa';
import { getStore, getCorrelationId, _resetForTesting } from '../../store';
import { ORGANIZATION_ID_HEADER, CORRELATION_ID_HEADER } from '../../headers';
import { MISSING_ORG_ERROR, MISSING_CORRELATION_WARN } from '../resolveContext';

const makeCtx = (headers: Record<string, string> = {}) => ({
    headers: { 'user-agent': 'agent/1', ...headers },
    url: '/orders',
    method: 'POST',
    status: 404,
    body: undefined as unknown,
});
const makeLogger = () => ({ warn: vi.fn(), error: vi.fn() });
const BOTH_HEADERS = {
    [ORGANIZATION_ID_HEADER]: 'org-1',
    [CORRELATION_ID_HEADER]: 'corr-1',
};

beforeEach(() => _resetForTesting());

describe('createKoaMiddleware', () => {
    it('runs next inside a context built from the request headers, logging nothing', async () => {
        const logger = makeLogger();
        const next = vi.fn(() => {
            expect(getStore()).toEqual({
                organizationId: 'org-1',
                correlationId: 'corr-1',
            });
            return Promise.resolve();
        });

        await createKoaMiddleware({ logger })(makeCtx(BOTH_HEADERS), next);

        expect(next).toHaveBeenCalledOnce();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('resolves only once downstream middleware has finished, with the context set throughout', async () => {
        const order: string[] = [];

        await createKoaMiddleware()(makeCtx(BOTH_HEADERS), async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            order.push(`downstream ${getStore()?.organizationId ?? 'none'}`);
        });
        order.push('resolved');

        expect(order).toEqual(['downstream org-1', 'resolved']);
    });

    it('passes a downstream error on', async () => {
        await expect(
            createKoaMiddleware()(makeCtx(BOTH_HEADERS), () =>
                Promise.reject(new Error('downstream failed')),
            ),
        ).rejects.toThrow('downstream failed');
    });

    it('generates a correlation ID when the header is missing, and warns with the request details', async () => {
        const logger = makeLogger();
        const next = vi.fn(() => {
            expect(getCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
            return Promise.resolve();
        });

        await createKoaMiddleware({ logger })(
            makeCtx({ [ORGANIZATION_ID_HEADER]: 'org-1' }),
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

    it('rejects a request without an organization ID with 400, logging it and never calling next', async () => {
        const logger = makeLogger();
        const ctx = makeCtx({ [CORRELATION_ID_HEADER]: 'corr-1' });
        const next = vi.fn(() => Promise.resolve());

        await createKoaMiddleware({ logger })(ctx, next);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({ error: MISSING_ORG_ERROR });
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

    it('also warns about a missing correlation ID when it rejects, so both problems are logged at once', async () => {
        const logger = makeLogger();

        await createKoaMiddleware({ logger })(makeCtx(), () => Promise.resolve());

        expect(logger.warn).toHaveBeenCalledWith(
            MISSING_CORRELATION_WARN,
            expect.any(Object),
        );
        expect(logger.error).toHaveBeenCalledOnce();
    });

    it('runs under the default organization in single-tenant mode, whatever the header says', async () => {
        const ctx = makeCtx({ ...BOTH_HEADERS, [ORGANIZATION_ID_HEADER]: 'other-org' });
        const next = vi.fn(() => {
            expect(getStore()?.organizationId).toBe('default-org');
            return Promise.resolve();
        });

        await createKoaMiddleware({ getDefaultOrgId: () => 'default-org' })(ctx, next);

        expect(next).toHaveBeenCalledOnce();
        expect(ctx.status).toBe(404);
    });

    it('rejects without a logger', async () => {
        const ctx = makeCtx();

        await createKoaMiddleware()(ctx, () => Promise.resolve());

        expect(ctx.status).toBe(400);
    });
});
