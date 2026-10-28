import { describe, it, expect, beforeEach } from 'vitest';
import {
    run,
    getOrganizationId,
    getCorrelationId,
    getStore,
    _resetForTesting,
} from '../store';
import { ORGANIZATION_ID_HEADER, CORRELATION_ID_HEADER } from '../headers';

beforeEach(() => {
    _resetForTesting();
});

describe('headers', () => {
    it('exports correct header names', () => {
        expect(ORGANIZATION_ID_HEADER).toBe('x-organization-id');
        expect(CORRELATION_ID_HEADER).toBe('correlation-id');
    });
});

describe('run', () => {
    it('returns the fn return value', () => {
        const result = run(
            { organizationId: 'org-1', correlationId: 'corr-1' },
            () => 42,
        );
        expect(result).toBe(42);
    });

    it('generates correlationId if not provided', () => {
        run({ organizationId: 'org-1' }, () => {
            expect(getCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
        });
    });

    it('generates correlationId when empty string provided', () => {
        run({ organizationId: 'org-1', correlationId: '' }, () => {
            expect(getCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
        });
    });

    it('throws when organizationId is whitespace only', () => {
        expect(() => run({ organizationId: '   ' }, () => {})).toThrow(
            'organizationId must not be empty',
        );
    });

    it('trims whitespace from organizationId', () => {
        run({ organizationId: '  org-1  ' }, () => {
            expect(getOrganizationId()).toBe('org-1');
        });
    });

    it('trims whitespace from correlationId', () => {
        run({ organizationId: 'org-1', correlationId: '  corr-1  ' }, () => {
            expect(getCorrelationId()).toBe('corr-1');
        });
    });

    it('generates correlationId when whitespace-only string provided', () => {
        run({ organizationId: 'org-1', correlationId: '   ' }, () => {
            expect(getCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
        });
    });

    it('makes organizationId accessible inside scope', () => {
        run({ organizationId: 'org-abc' }, () => {
            expect(getOrganizationId()).toBe('org-abc');
        });
    });

    it('makes correlationId accessible inside scope', () => {
        run({ organizationId: 'org-abc', correlationId: 'corr-xyz' }, () => {
            expect(getCorrelationId()).toBe('corr-xyz');
        });
    });

    it('propagates through async calls', async () => {
        await run({ organizationId: 'org-async' }, async () => {
            await Promise.resolve();
            expect(getOrganizationId()).toBe('org-async');
        });
    });
});

describe('getOrganizationId', () => {
    it('throws outside a context scope', () => {
        expect(() => getOrganizationId()).toThrow('No request context');
    });
});

describe('getCorrelationId', () => {
    it('throws outside a context scope', () => {
        expect(() => getCorrelationId()).toThrow('No request context');
    });
});

describe('getStore', () => {
    it('returns undefined outside a context scope', () => {
        expect(getStore()).toBeUndefined();
    });

    it('returns the context object inside a scope', () => {
        run({ organizationId: 'org-1', correlationId: 'corr-1' }, () => {
            expect(getStore()).toEqual({
                organizationId: 'org-1',
                correlationId: 'corr-1',
            });
        });
    });
});
