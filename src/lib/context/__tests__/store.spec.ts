import { describe, it, expect, beforeEach } from 'vitest';
import {
    run,
    getOrganizationId,
    getCorrelationId,
    getStore,
    _resetForTesting,
} from '../store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
    _resetForTesting();
});

describe('run', () => {
    it('returns what the function returns, a promise included', async () => {
        expect(run({ organizationId: 'org-1' }, () => 42)).toBe(42);
        await expect(
            run({ organizationId: 'org-1' }, () => Promise.resolve('done')),
        ).resolves.toBe('done');
    });

    it('lets an error from the function propagate and ends the context', () => {
        expect(() =>
            run({ organizationId: 'org-1' }, () => {
                throw new Error('boom');
            }),
        ).toThrow('boom');
        expect(getStore()).toBeUndefined();
    });

    it('trims both IDs', () => {
        run({ organizationId: '  org-1  ', correlationId: '  corr-1  ' }, () => {
            expect(getStore()).toEqual({
                organizationId: 'org-1',
                correlationId: 'corr-1',
            });
        });
    });

    it.each(['', '   '])(
        'refuses an organizationId of %j before running the function',
        (organizationId) => {
            let ran = false;
            expect(() =>
                run({ organizationId }, () => {
                    ran = true;
                }),
            ).toThrow('organizationId must not be empty');
            expect(ran).toBe(false);
        },
    );

    it.each([undefined, '', '   '])(
        'generates a UUID correlationId when given %j',
        (correlationId) => {
            run({ organizationId: 'org-1', correlationId }, () => {
                expect(getCorrelationId()).toMatch(UUID);
            });
        },
    );

    it('generates a different correlationId for each run', () => {
        const ids = [1, 2].map(() =>
            run({ organizationId: 'org-1' }, () => getCorrelationId()),
        );
        expect(ids[0]).not.toBe(ids[1]);
    });
});

describe('context scope', () => {
    it('follows the work through awaits and timers', async () => {
        await run({ organizationId: 'org-async' }, async () => {
            await Promise.resolve();
            await new Promise((resolve) => setTimeout(resolve, 1));
            expect(getOrganizationId()).toBe('org-async');
        });
    });

    it('keeps concurrent runs apart', async () => {
        const seen = await Promise.all(
            ['org-a', 'org-b'].map((organizationId, i) =>
                run({ organizationId }, async () => {
                    await new Promise((resolve) => setTimeout(resolve, 5 - i * 4));
                    return getOrganizationId();
                }),
            ),
        );
        expect(seen).toEqual(['org-a', 'org-b']);
    });

    it('lets a nested run replace the context, and restores the outer one after it', () => {
        run({ organizationId: 'outer', correlationId: 'corr-outer' }, () => {
            run({ organizationId: 'inner', correlationId: 'corr-inner' }, () => {
                expect(getStore()).toEqual({
                    organizationId: 'inner',
                    correlationId: 'corr-inner',
                });
            });
            expect(getOrganizationId()).toBe('outer');
        });
    });
});

describe('outside a context', () => {
    it('getStore is undefined', () => {
        expect(getStore()).toBeUndefined();
    });

    it('getOrganizationId and getCorrelationId throw', () => {
        expect(() => getOrganizationId()).toThrow('No request context');
        expect(() => getCorrelationId()).toThrow('No request context');
    });
});
