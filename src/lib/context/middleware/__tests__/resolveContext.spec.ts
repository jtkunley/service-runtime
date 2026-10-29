import { describe, it, expect, vi } from 'vitest';
import {
    resolveContext,
    resolveRequestContext,
    MISSING_ORG_ERROR,
} from '../resolveContext';
import { ORGANIZATION_ID_HEADER, CORRELATION_ID_HEADER } from '../../headers';

describe('resolveContext', () => {
    describe('multi-tenant, with no default organization', () => {
        it('takes the organization and correlation IDs from the caller, trimmed', () => {
            expect(resolveContext('  org-1  ', '  corr-1  ', {})).toEqual({
                type: 'ok',
                organizationId: 'org-1',
                correlationId: 'corr-1',
            });
        });

        it.each([undefined, '', '   '])(
            'rejects an organization ID of %j with 400, keeping the correlation ID',
            (organizationId) => {
                expect(resolveContext(organizationId, 'corr-1', {})).toEqual({
                    type: 'error',
                    status: 400,
                    error: MISSING_ORG_ERROR,
                    organizationId: undefined,
                    correlationId: 'corr-1',
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

    describe('single-tenant, with a default organization', () => {
        it.each([
            ['no organization ID', undefined],
            ['the same organization ID', 'default-org'],
            ['a different organization ID', 'other-org'],
        ])('runs under the default, trimmed, given %s', (_name, given) => {
            expect(
                resolveContext(given, 'corr-1', {
                    getDefaultOrgId: () => '  default-org  ',
                }),
            ).toEqual({
                type: 'ok',
                organizationId: 'default-org',
                correlationId: 'corr-1',
            });
        });

        it('reads the default on every call', () => {
            const getDefaultOrgId = vi
                .fn<() => string | undefined>()
                .mockReturnValueOnce('org-a')
                .mockReturnValueOnce('org-b');
            const opts = { getDefaultOrgId };

            expect(resolveContext(undefined, undefined, opts)).toMatchObject({ organizationId: 'org-a' });
            expect(resolveContext(undefined, undefined, opts)).toMatchObject({ organizationId: 'org-b' });
        });
    });

    it.each([undefined, '', '   '])(
        'leaves the correlation ID undefined when given %j',
        (correlationId) => {
            expect(resolveContext('org-1', correlationId, {})).toMatchObject({
                type: 'ok',
                correlationId: undefined,
            });
        },
    );
});

describe('resolveRequestContext', () => {
    it('reads both IDs from their request headers', () => {
        expect(
            resolveRequestContext(
                {
                    [ORGANIZATION_ID_HEADER]: 'org-1',
                    [CORRELATION_ID_HEADER]: 'corr-1',
                },
                {},
            ),
        ).toEqual({
            type: 'ok',
            organizationId: 'org-1',
            correlationId: 'corr-1',
        });
    });

    it('rejects a request without the organization header', () => {
        expect(resolveRequestContext({}, {})).toMatchObject({
            type: 'error',
            error: `Missing required header: ${ORGANIZATION_ID_HEADER}`,
        });
    });
});
