import { describe, it, expect, beforeEach } from 'vitest';
import {
    run,
    getOrgId,
    getRequestId,
    getStore,
    _resetForTesting,
} from '../store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
    _resetForTesting();
});

describe('run', () => {
    it('returns what the function returns, a promise included', async () => {
        expect(run({ orgId: 'org-1' }, () => 42)).toBe(42);
        await expect(
            run({ orgId: 'org-1' }, () => Promise.resolve('done')),
        ).resolves.toBe('done');
    });

    it('lets an error from the function propagate and ends the context', () => {
        expect(() =>
            run({ orgId: 'org-1' }, () => {
                throw new Error('boom');
            }),
        ).toThrow('boom');
        expect(getStore()).toBeUndefined();
    });

    it('trims both IDs', () => {
        run({ orgId: '  org-1  ', requestId: '  corr-1  ' }, () => {
            expect(getStore()).toEqual({
                orgId: 'org-1',
                requestId: 'corr-1',
            });
        });
    });

    it.each(['', '   '])(
        'refuses an orgId of %j before running the function',
        (orgId) => {
            let ran = false;
            expect(() =>
                run({ orgId }, () => {
                    ran = true;
                }),
            ).toThrow('orgId must not be empty');
            expect(ran).toBe(false);
        },
    );

    it.each([undefined, '', '   '])(
        'generates a UUID requestId when given %j',
        (requestId) => {
            run({ orgId: 'org-1', requestId }, () => {
                expect(getRequestId()).toMatch(UUID);
            });
        },
    );

    it('generates a different requestId for each run', () => {
        const ids = [1, 2].map(() =>
            run({ orgId: 'org-1' }, () => getRequestId()),
        );
        expect(ids[0]).not.toBe(ids[1]);
    });
});

describe('context scope', () => {
    it('follows the work through awaits and timers', async () => {
        await run({ orgId: 'org-async' }, async () => {
            await Promise.resolve();
            await new Promise((resolve) => setTimeout(resolve, 1));
            expect(getOrgId()).toBe('org-async');
        });
    });

    it('keeps concurrent runs apart', async () => {
        const seen = await Promise.all(
            ['org-a', 'org-b'].map((orgId, i) =>
                run({ orgId }, async () => {
                    await new Promise((resolve) => setTimeout(resolve, 5 - i * 4));
                    return getOrgId();
                }),
            ),
        );
        expect(seen).toEqual(['org-a', 'org-b']);
    });

    it('lets a nested run replace the context, and restores the outer one after it', () => {
        run({ orgId: 'outer', requestId: 'corr-outer' }, () => {
            run({ orgId: 'inner', requestId: 'corr-inner' }, () => {
                expect(getStore()).toEqual({
                    orgId: 'inner',
                    requestId: 'corr-inner',
                });
            });
            expect(getOrgId()).toBe('outer');
        });
    });
});

describe('outside a context', () => {
    it('getStore is undefined', () => {
        expect(getStore()).toBeUndefined();
    });

    it('getOrgId and getRequestId throw', () => {
        expect(() => getOrgId()).toThrow('No request context');
        expect(() => getRequestId()).toThrow('No request context');
    });
});
