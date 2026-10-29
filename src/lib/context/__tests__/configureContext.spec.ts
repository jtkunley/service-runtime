import { randomUUID } from 'crypto';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { configureContext, contextInternals, type ContextRequest } from '../configureContext';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const makeContext = () =>
    configureContext({
        tenantId: { value: (req) => req.headers['x-tenant-id'], required: true },
        requestId: { value: (req) => req.headers['x-request-id'] ?? randomUUID() },
        locale: { value: (req) => req.headers['accept-language'] },
    });

const TENANT = { headers: { 'x-tenant-id': 'tenant-1' } };

describe('configureContext', () => {
    describe('run', () => {
        it('works out every value from the source, trimmed, whatever the header case', () => {
            const context = makeContext();

            context.run(
                { headers: { 'X-Tenant-Id': '  tenant-1 ', 'x-request-id': ' req-1  ' } },
                () => {
                    expect(context.getStore()).toEqual({
                        tenantId: 'tenant-1',
                        requestId: 'req-1',
                        locale: undefined,
                    });
                },
            );
        });

        it('joins the values of a header sent more than once', () => {
            const context = makeContext();

            context.run({ headers: { ...TENANT.headers, 'accept-language': ['en', 'fr'] } }, () => {
                expect(context.get('locale')).toBe('en, fr');
            });
        });

        it('calls each value function once, with the headers, method and path', () => {
            const value = vi.fn((_req: ContextRequest) => 'v');
            const context = configureContext({ entry: { value } });

            context.run({ headers: { 'x-a': '1' }, method: 'GET', path: '/a' }, () => undefined);

            expect(value).toHaveBeenCalledOnce();
            expect(value).toHaveBeenCalledWith({
                headers: { 'x-a': '1' },
                method: 'GET',
                path: '/a',
            });
        });

        it.each([undefined, '', '   '])(
            'treats a value of %j as absent, leaving an optional entry undefined',
            (locale) => {
                const context = makeContext();

                context.run({ headers: { ...TENANT.headers, 'accept-language': locale } }, () => {
                    expect(context.get('locale')).toBeUndefined();
                });
            },
        );

        it('lets a value function supply a value the request lacks', () => {
            const context = makeContext();

            context.run(TENANT, () => {
                expect(context.get('requestId')).toMatch(UUID);
            });
        });

        it('returns what the function returns, a promise included', async () => {
            const context = makeContext();

            expect(context.run(TENANT, () => 42)).toBe(42);
            await expect(context.run(TENANT, () => Promise.resolve('done'))).resolves.toBe('done');
        });

        it.each([
            ['one required entry', 'tenant-1', 'Missing required context value: region'],
            [
                'two required entries',
                undefined,
                'Missing required context values: tenantId, region',
            ],
        ])('refuses to run without %s, naming every one missing', (_name, tenantId, message) => {
            const context = configureContext({
                tenantId: { value: () => tenantId, required: true },
                region: { value: () => undefined, required: true },
            });
            const fn = vi.fn<() => void>();

            expect(() => context.run({ headers: {} }, fn)).toThrow(message);
            expect(fn).not.toHaveBeenCalled();
        });

        it('lets an error from the function propagate and ends the context', () => {
            const context = makeContext();

            expect(() =>
                context.run(TENANT, () => {
                    throw new Error('boom');
                }),
            ).toThrow('boom');
            expect(context.getStore()).toBeUndefined();
        });
    });

    describe('context scope', () => {
        it('follows the work through awaits and timers', async () => {
            const context = makeContext();

            await context.run(TENANT, async () => {
                await Promise.resolve();
                await new Promise((resolve) => setTimeout(resolve, 1));
                expect(context.get('tenantId')).toBe('tenant-1');
            });
        });

        it('keeps concurrent runs apart', async () => {
            const context = makeContext();

            const seen = await Promise.all(
                ['tenant-a', 'tenant-b'].map((tenantId, i) =>
                    context.run({ headers: { 'x-tenant-id': tenantId } }, async () => {
                        await new Promise((resolve) => setTimeout(resolve, 5 - i * 4));
                        return context.get('tenantId');
                    }),
                ),
            );

            expect(seen).toEqual(['tenant-a', 'tenant-b']);
        });

        it('lets a nested run replace the values, and restores the outer ones after it', () => {
            const context = makeContext();

            context.run({ headers: { 'x-tenant-id': 'outer' } }, () => {
                context.run({ headers: { 'x-tenant-id': 'inner' } }, () => {
                    expect(context.get('tenantId')).toBe('inner');
                });
                expect(context.get('tenantId')).toBe('outer');
            });
        });

        it('keeps separately configured contexts apart', () => {
            const first = makeContext();
            const second = makeContext();

            first.run(TENANT, () => {
                expect(second.getStore()).toBeUndefined();
            });
        });
    });

    describe('get', () => {
        it('types a required entry as always present and any other as possibly absent', () => {
            const context = makeContext();

            context.run(TENANT, () => {
                expectTypeOf(context.get('tenantId')).toEqualTypeOf<string>();
                expectTypeOf(context.get('locale')).toEqualTypeOf<string | undefined>();
                // @ts-expect-error -- only configured entries can be read
                context.get('unknown');
            });
        });

        it('makes an attribute ContextEntry does not have a compile error', () => {
            // @ts-expect-error -- a misspelt attribute would otherwise be ignored silently
            configureContext({ entry: { value: () => 'v', requried: true } });
        });
    });

    describe('getStore', () => {
        it('hands out values that cannot be changed, so nothing can switch them mid-request', () => {
            const context = makeContext();

            context.run(TENANT, () => {
                const values = context.getStore() as { tenantId: string };

                expect(() => {
                    values.tenantId = 'other-tenant';
                }).toThrow(TypeError);
                expect(context.get('tenantId')).toBe('tenant-1');
            });
        });
    });

    describe('outside a context', () => {
        it('getStore is undefined', () => {
            expect(makeContext().getStore()).toBeUndefined();
        });

        it('get throws', () => {
            expect(() => makeContext().get('tenantId')).toThrow('No request context');
        });
    });
});

describe('contextInternals', () => {
    it('refuses an object that configureContext did not create', () => {
        expect(() => contextInternals({})).toThrow(
            new TypeError('Expected a context created by configureContext'),
        );
    });
});
