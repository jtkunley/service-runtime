import { describe, it, expect, vi } from 'vitest';
import {
    resolveContext,
    resolveRequestContext,
    MISSING_ORG_ERROR,
} from '../resolveContext';
import { ORG_ID_HEADER, REQUEST_ID_HEADER } from '../../headers';

describe('resolveContext', () => {
    describe('multi-tenant, with no default org', () => {
        it('takes the org and request IDs from the caller, trimmed', () => {
            expect(resolveContext('  org-1  ', '  corr-1  ', {})).toEqual({
                type: 'ok',
                orgId: 'org-1',
                requestId: 'corr-1',
            });
        });

        it.each([undefined, '', '   '])(
            'rejects an org ID of %j with 400, keeping the request ID',
            (orgId) => {
                expect(resolveContext(orgId, 'corr-1', {})).toEqual({
                    type: 'error',
                    status: 400,
                    error: MISSING_ORG_ERROR,
                    orgId: undefined,
                    requestId: 'corr-1',
                });
            },
        );

        it.each([undefined, '', '   '])(
            'treats a default of %j as none',
            (defaultOrgId) => {
                expect(
                    resolveContext(undefined, undefined, {
                        getDefaultOrgId: () => defaultOrgId,
                    }),
                ).toMatchObject({ type: 'error', status: 400 });
            },
        );
    });

    describe('single-tenant, with a default org', () => {
        it.each([
            ['no org ID', undefined],
            ['the same org ID', 'default-org'],
            ['a different org ID', 'other-org'],
        ])('runs under the default, trimmed, given %s', (_name, given) => {
            expect(
                resolveContext(given, 'corr-1', {
                    getDefaultOrgId: () => '  default-org  ',
                }),
            ).toEqual({
                type: 'ok',
                orgId: 'default-org',
                requestId: 'corr-1',
            });
        });

        it('reads the default on every call', () => {
            const getDefaultOrgId = vi
                .fn<() => string | undefined>()
                .mockReturnValueOnce('org-a')
                .mockReturnValueOnce('org-b');
            const opts = { getDefaultOrgId };

            expect(resolveContext(undefined, undefined, opts)).toMatchObject({ orgId: 'org-a' });
            expect(resolveContext(undefined, undefined, opts)).toMatchObject({ orgId: 'org-b' });
        });
    });

    it.each([undefined, '', '   '])(
        'leaves the request ID undefined when given %j',
        (requestId) => {
            expect(resolveContext('org-1', requestId, {})).toMatchObject({
                type: 'ok',
                requestId: undefined,
            });
        },
    );
});

describe('resolveRequestContext', () => {
    it('reads both IDs from their request headers', () => {
        expect(
            resolveRequestContext(
                {
                    [ORG_ID_HEADER]: 'org-1',
                    [REQUEST_ID_HEADER]: 'corr-1',
                },
                {},
            ),
        ).toEqual({
            type: 'ok',
            orgId: 'org-1',
            requestId: 'corr-1',
        });
    });

    it('rejects a request without the org ID header', () => {
        expect(resolveRequestContext({}, {})).toMatchObject({
            type: 'error',
            error: `Missing required header: ${ORG_ID_HEADER}`,
        });
    });
});
