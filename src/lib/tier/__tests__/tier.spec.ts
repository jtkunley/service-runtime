import { describe, expect, it, vi } from 'vitest';
import {
    getTier,
    isNonProdTier,
    isProdTier,
    NON_PROD_TIER_PATTERN,
    PROD_TIER_PATTERN,
} from '../tier';

describe('getTier', () => {
    it.each([
        ['dev', 'dev'],
        ['  dev  ', 'dev'],
        ['\tPROD\n', 'prod'],
        ['Pr42', 'pr42'],
        ['Staging', 'staging'],
    ])('reads %j as %j', (raw, tier) => {
        expect(getTier({ TIER: raw })).toBe(tier);
    });

    it.each([
        ['unset', {}],
        ['undefined', { TIER: undefined }],
        ['empty', { TIER: '' }],
        ['blank', { TIER: ' \t\n' }],
    ])('is undefined when TIER is %s', (_name, env) => {
        expect(getTier(env)).toBeUndefined();
    });

    it('ignores a TIER the environment only inherits', () => {
        const env = Object.create({ TIER: 'dev' }) as Record<
            string,
            string | undefined
        >;

        expect(getTier(env)).toBeUndefined();
    });

    it('reads process.env by default', () => {
        vi.stubEnv('TIER', ' Test ');
        try {
            expect(getTier()).toBe('test');
        } finally {
            vi.unstubAllEnvs();
        }
    });
});

const NON_PROD = [
    'local',
    'dev',
    'test',
    'qa',
    'staging',
    'pr1',
    'pr42',
    'pr0',
    'pr123456',
    ' QA ',
    'Staging',
    'PR7',
    '\tDev\n',
];

const PROD = ['prod', 'production', ' PROD ', 'Production'];

const UNKNOWN = [
    undefined,
    '',
    ' ',
    'prd',
    'live',
    'uat',
    'stage',
    'stg',
    'demo',
    'sandbox',
    'devel',
    'tst',
    'qa1',
    'staging2',
    'prod2',
    'preprod',
    'pr',
    'pr1a',
    'pr-1',
    'pr 1',
    'apr1',
    'devx',
    'mytest',
    'dev-2',
    'dev.prod',
    'dev|prod',
    'local\nprod',
    'pr١',
];

describe('isNonProdTier and isProdTier', () => {
    it.each(NON_PROD)('know %j is non-production', (tier) => {
        expect(isNonProdTier(tier)).toBe(true);
        expect(isProdTier(tier)).toBe(false);
    });

    it.each(PROD)('know %j is production', (tier) => {
        expect(isProdTier(tier)).toBe(true);
        expect(isNonProdTier(tier)).toBe(false);
    });

    // Defaulting an unknown tier to either side unlocks what that side gates.
    it.each(UNKNOWN)('treat %j as neither', (tier) => {
        expect(isNonProdTier(tier)).toBe(false);
        expect(isProdTier(tier)).toBe(false);
    });

    it('agree with getTier on a raw TIER', () => {
        expect(isNonProdTier(getTier({ TIER: ' QA ' }))).toBe(true);
        expect(isProdTier(getTier({ TIER: '\tPROD\n' }))).toBe(true);
    });

    it('exports both patterns as these exact strings, and the checks themselves not at all', async () => {
        expect(NON_PROD_TIER_PATTERN).toBe(
            '^(?:local|dev|test|qa|staging|pr\\d+)$',
        );
        expect(PROD_TIER_PATTERN).toBe('^(?:prod|production)$');
        expect(Object.keys(await import('../tier.js')).sort()).toEqual([
            'NON_PROD_TIER_PATTERN',
            'PROD_TIER_PATTERN',
            'getTier',
            'isNonProdTier',
            'isProdTier',
        ]);
    });
});
