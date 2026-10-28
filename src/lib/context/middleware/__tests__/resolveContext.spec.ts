import { describe, it, expect } from 'vitest';
import {
    resolveContext,
    resolveRequestContext,
    MISSING_ORG_ERROR,
} from '../resolveContext';
import { ORGANIZATION_ID_HEADER, CORRELATION_ID_HEADER } from '../../headers';

describe('resolveContext', () => {
    it('returns error when organizationId and correlationId absent and no default', () => {
        expect(resolveContext(undefined, undefined, {})).toMatchObject({
            type: 'error',
            status: 400,
        });
    });

    it('returns ok with the given organizationId and correlationId', () => {
        expect(resolveContext('org-1', 'corr-1', {})).toMatchObject({
            type: 'ok',
            organizationId: 'org-1',
            correlationId: 'corr-1',
        });
    });

    it('proceeds under the default org ID when given org ID mismatches (single-tenant)', () => {
        const result = resolveContext('other-org', 'corr-1', {
            getDefaultOrgId: () => 'default-org',
        });
        expect(result).toMatchObject({
            type: 'ok',
            organizationId: 'default-org',
        });
    });

    it('trims whitespace from both values', () => {
        const result = resolveContext('  org-1  ', '  corr-1  ', {});
        expect(result).toMatchObject({
            type: 'ok',
            organizationId: 'org-1',
            correlationId: 'corr-1',
        });
    });
});

describe('resolveRequestContext', () => {
    it('returns missing when org header absent and no fallback', () => {
        expect(resolveRequestContext({}, {})).toMatchObject({
            type: 'error',
            status: 400,
        });
    });

    it('returns missing when getDefaultOrgId returns undefined', () => {
        expect(
            resolveRequestContext({}, { getDefaultOrgId: () => undefined }),
        ).toMatchObject({ type: 'error', status: 400 });
    });

    it('returns ok with orgId from header', () => {
        const result = resolveRequestContext(
            { [ORGANIZATION_ID_HEADER]: 'org-1' },
            {},
        );
        expect(result).toMatchObject({ type: 'ok', organizationId: 'org-1' });
    });

    it('returns ok with orgId from default when no header', () => {
        const result = resolveRequestContext(
            {},
            { getDefaultOrgId: () => 'default-org' },
        );
        expect(result).toMatchObject({
            type: 'ok',
            organizationId: 'default-org',
        });
    });

    it('returns ok when header and default match', () => {
        const result = resolveRequestContext(
            { [ORGANIZATION_ID_HEADER]: 'org-1' },
            { getDefaultOrgId: () => 'org-1' },
        );
        expect(result).toMatchObject({ type: 'ok', organizationId: 'org-1' });
    });

    it('proceeds under the configured default when header org ID mismatches (single-tenant)', () => {
        const result = resolveRequestContext(
            { [ORGANIZATION_ID_HEADER]: 'header-org' },
            { getDefaultOrgId: () => 'default-org' },
        );
        expect(result).toMatchObject({
            type: 'ok',
            organizationId: 'default-org',
        });
    });

    it('returns ok with correlationId from header', () => {
        const result = resolveRequestContext(
            {
                [ORGANIZATION_ID_HEADER]: 'org-1',
                [CORRELATION_ID_HEADER]: 'corr-1',
            },
            {},
        );
        expect(result).toMatchObject({ type: 'ok', correlationId: 'corr-1' });
    });

    it('returns ok with undefined correlationId when header absent', () => {
        const result = resolveRequestContext(
            { [ORGANIZATION_ID_HEADER]: 'org-1' },
            {},
        );
        expect(result).toMatchObject({ type: 'ok', correlationId: undefined });
    });

    it('trims whitespace from header org ID', () => {
        const result = resolveRequestContext(
            { [ORGANIZATION_ID_HEADER]: '  org-1  ' },
            {},
        );
        expect(result).toMatchObject({ type: 'ok', organizationId: 'org-1' });
    });

    it('trims whitespace from correlation ID header', () => {
        const result = resolveRequestContext(
            {
                [ORGANIZATION_ID_HEADER]: 'org-1',
                [CORRELATION_ID_HEADER]: '  corr-1  ',
            },
            {},
        );
        expect(result).toMatchObject({ type: 'ok', correlationId: 'corr-1' });
    });

    it('returns error when org ID header is whitespace only', () => {
        const result = resolveRequestContext(
            { [ORGANIZATION_ID_HEADER]: '   ' },
            {},
        );
        expect(result).toMatchObject({ type: 'error' });
    });

    it('trims getDefaultOrgId value', () => {
        const result = resolveRequestContext(
            {},
            { getDefaultOrgId: () => '  default-org  ' },
        );
        expect(result).toMatchObject({
            type: 'ok',
            organizationId: 'default-org',
        });
    });
});

describe('headers', () => {
    it('MISSING_ORG_ERROR references correct header name', () => {
        expect(MISSING_ORG_ERROR).toContain(ORGANIZATION_ID_HEADER);
    });
});
