import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKoaMiddleware } from '../koa';
import { getOrganizationId, _resetForTesting } from '../../store';
import { ORGANIZATION_ID_HEADER, CORRELATION_ID_HEADER } from '../../headers';
import { MISSING_ORG_ERROR, MISSING_CORRELATION_WARN } from '../resolveContext';

const makeCtx = (
    headers: Record<string, string> = {},
    url = '/test',
    method = 'GET',
) => ({
    headers,
    method,
    url,
    status: 200,
    body: undefined as unknown,
});

beforeEach(() => _resetForTesting());

describe('createKoaMiddleware', () => {
    it('warns when correlation ID header absent, includes resolved organizationId', async () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const mw = createKoaMiddleware({ logger });
        await mw(
            makeCtx({ [ORGANIZATION_ID_HEADER]: 'org-1' }),
            vi.fn().mockResolvedValue(undefined),
        );
        expect(logger.warn).toHaveBeenCalledWith(
            MISSING_CORRELATION_WARN,
            expect.objectContaining({ organizationId: 'org-1' }),
        );
    });

    it('does not warn when correlation ID header present', async () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const mw = createKoaMiddleware({ logger });
        await mw(
            makeCtx({
                [ORGANIZATION_ID_HEADER]: 'org-1',
                [CORRELATION_ID_HEADER]: 'corr-1',
            }),
            vi.fn().mockResolvedValue(undefined),
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('calls next() and establishes context', async () => {
        const mw = createKoaMiddleware();
        const ctx = makeCtx({
            [ORGANIZATION_ID_HEADER]: 'org-1',
            [CORRELATION_ID_HEADER]: 'corr-1',
        });
        const next = vi.fn(() => {
            expect(getOrganizationId()).toBe('org-1');
            return Promise.resolve();
        });
        await mw(ctx, next);
        expect(next).toHaveBeenCalledOnce();
    });

    it('proceeds under the default org ID when header org ID differs (single-tenant)', async () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const mw = createKoaMiddleware({
            getDefaultOrgId: () => 'default-org',
            logger,
        });
        const ctx = makeCtx({
            [ORGANIZATION_ID_HEADER]: 'other-org',
            [CORRELATION_ID_HEADER]: 'corr-1',
        });
        const next = vi.fn(() => {
            expect(getOrganizationId()).toBe('default-org');
            return Promise.resolve();
        });
        await mw(ctx, next);
        expect(ctx.status).toBe(200);
        expect(next).toHaveBeenCalledOnce();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('sets MISSING_ORG_STATUS and MISSING_ORG_ERROR when orgId absent', async () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const mw = createKoaMiddleware({ logger });
        const ctx = makeCtx();
        const next = vi.fn().mockResolvedValue(undefined);
        await mw(ctx, next);
        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({ error: MISSING_ORG_ERROR });
        expect(logger.error).toHaveBeenCalledOnce();
        expect(next).not.toHaveBeenCalled();
    });
});
