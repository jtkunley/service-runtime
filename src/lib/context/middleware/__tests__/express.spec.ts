import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExpressMiddleware } from '../express';
import { getOrganizationId, _resetForTesting } from '../../store';
import { ORGANIZATION_ID_HEADER, CORRELATION_ID_HEADER } from '../../headers';
import { MISSING_ORG_ERROR, MISSING_CORRELATION_WARN } from '../resolveContext';

const makeReq = (
    headers: Record<string, string> = {},
    url = '/test',
    method = 'GET',
) =>
    ({ headers, url, method });
const makeRes = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
});
const makeNext = () => vi.fn();

beforeEach(() => _resetForTesting());

describe('createExpressMiddleware', () => {
    it('warns when correlation ID header absent, includes resolved organizationId', () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const mw = createExpressMiddleware({ logger });
        mw(
            makeReq({ [ORGANIZATION_ID_HEADER]: 'org-1' }),
            makeRes(),
            vi.fn(),
        );
        expect(logger.warn).toHaveBeenCalledWith(
            MISSING_CORRELATION_WARN,
            expect.objectContaining({ organizationId: 'org-1' }),
        );
    });

    it('does not warn when correlation ID header present', () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const mw = createExpressMiddleware({ logger });
        mw(
            makeReq({
                [ORGANIZATION_ID_HEADER]: 'org-1',
                [CORRELATION_ID_HEADER]: 'corr-1',
            }),
            makeRes(),
            vi.fn(),
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('calls next() and establishes context', () => {
        const mw = createExpressMiddleware();
        const next = vi.fn(() => {
            expect(getOrganizationId()).toBe('org-1');
        });
        mw(
            makeReq({
                [ORGANIZATION_ID_HEADER]: 'org-1',
                [CORRELATION_ID_HEADER]: 'corr-1',
            }),
            makeRes(),
            next,
        );
        expect(next).toHaveBeenCalledOnce();
    });

    it('proceeds under the default org ID when header org ID differs (single-tenant)', () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const mw = createExpressMiddleware({
            getDefaultOrgId: () => 'default-org',
            logger,
        });
        const res = makeRes();
        const next = vi.fn(() => {
            expect(getOrganizationId()).toBe('default-org');
        });
        mw(
            makeReq({
                [ORGANIZATION_ID_HEADER]: 'other-org',
                [CORRELATION_ID_HEADER]: 'corr-1',
            }),
            res,
            next,
        );
        expect(res.status).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('returns MISSING_ORG_STATUS and MISSING_ORG_ERROR when orgId absent', () => {
        const logger = { warn: vi.fn(), error: vi.fn() };
        const mw = createExpressMiddleware({ logger });
        const res = makeRes();
        const next = makeNext();
        mw(makeReq(), res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: MISSING_ORG_ERROR });
        expect(logger.error).toHaveBeenCalledOnce();
        expect(next).not.toHaveBeenCalled();
    });
});
