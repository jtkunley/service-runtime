import { describe, it, expect, vi } from 'vitest';
import type { IncomingHttpHeaders } from 'http';
import { resolveContext, type ContextMiddlewareOptions } from '../resolveContext';
import { ORG_ID_HEADER, REQUEST_ID_HEADER } from '../headers';

const MISSING_ORG = 'Missing required header: x-org-id';
const MISSING_REQUEST_ID = 'Missing x-request-id header — generated a new one';

const request = (headers: IncomingHttpHeaders = {}) => ({
    headers: { 'user-agent': 'agent/1', ...headers },
    method: 'POST',
    path: '/orders',
});
const makeLogger = () => ({ warn: vi.fn(), error: vi.fn() });
const resolve = (headers: IncomingHttpHeaders, opts: ContextMiddlewareOptions = {}) =>
    resolveContext(request(headers), opts);

describe('resolveContext', () => {
    describe('multi-tenant, with no default org', () => {
        it('takes both IDs from the request headers, trimmed', () => {
            expect(
                resolve({ [ORG_ID_HEADER]: '  org-1  ', [REQUEST_ID_HEADER]: '  req-1  ' }),
            ).toEqual({ orgId: 'org-1', requestId: 'req-1' });
        });

        it.each([undefined, '', '   '])('rejects an org ID of %j', (orgId) => {
            expect(resolve({ [ORG_ID_HEADER]: orgId })).toEqual({ error: MISSING_ORG });
        });

        it.each([undefined, '', '   '])('treats a default of %j as none', (defaultOrgId) => {
            expect(resolve({}, { getDefaultOrgId: () => defaultOrgId })).toEqual({
                error: MISSING_ORG,
            });
        });
    });

    describe('single-tenant, with a default org', () => {
        it.each([
            ['no org ID', undefined],
            ['the same org ID', 'default-org'],
            ['a different org ID', 'other-org'],
        ])('runs under the default, trimmed, given %s', (_name, orgId) => {
            expect(
                resolve(
                    { [ORG_ID_HEADER]: orgId, [REQUEST_ID_HEADER]: 'req-1' },
                    { getDefaultOrgId: () => '  default-org  ' },
                ),
            ).toEqual({ orgId: 'default-org', requestId: 'req-1' });
        });

        it('reads the default on every request', () => {
            const getDefaultOrgId = vi
                .fn<() => string | undefined>()
                .mockReturnValueOnce('org-a')
                .mockReturnValueOnce('org-b');

            expect(resolve({}, { getDefaultOrgId })).toMatchObject({ orgId: 'org-a' });
            expect(resolve({}, { getDefaultOrgId })).toMatchObject({ orgId: 'org-b' });
        });
    });

    it.each([undefined, '', '   '])('leaves the request ID undefined when given %j', (requestId) => {
        expect(resolve({ [ORG_ID_HEADER]: 'org-1', [REQUEST_ID_HEADER]: requestId })).toEqual({
            orgId: 'org-1',
            requestId: undefined,
        });
    });

    describe('logging', () => {
        it('logs nothing for a request with both IDs', () => {
            const logger = makeLogger();

            resolve({ [ORG_ID_HEADER]: 'org-1', [REQUEST_ID_HEADER]: 'req-1' }, { logger });

            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
        });

        it('warns about a missing request ID with the request details', () => {
            const logger = makeLogger();

            resolve({ [ORG_ID_HEADER]: 'org-1' }, { logger });

            expect(logger.warn).toHaveBeenCalledWith(MISSING_REQUEST_ID, {
                method: 'POST',
                path: '/orders',
                orgId: 'org-1',
                requestId: undefined,
                userAgent: 'agent/1',
            });
        });

        it('logs a missing org ID as an error with the request details', () => {
            const logger = makeLogger();

            resolve({ [REQUEST_ID_HEADER]: 'req-1' }, { logger });

            expect(logger.error).toHaveBeenCalledWith(MISSING_ORG, new Error(MISSING_ORG), {
                method: 'POST',
                path: '/orders',
                orgId: undefined,
                requestId: 'req-1',
                userAgent: 'agent/1',
            });
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('logs both problems of a request missing both IDs, so they show up at once', () => {
            const logger = makeLogger();

            resolve({}, { logger });

            expect(logger.warn).toHaveBeenCalledWith(MISSING_REQUEST_ID, expect.any(Object));
            expect(logger.error).toHaveBeenCalledWith(MISSING_ORG, expect.any(Error), expect.any(Object));
        });

        it('works without a logger', () => {
            expect(resolve({})).toEqual({ error: MISSING_ORG });
        });
    });
});
