import { describe, it, expect } from 'vitest';
import { configureContext } from '../configureContext';
import { createGetHeaders } from '../getHeaders';

const CONFIG = {
    tenantId: { value: () => 'tenant-1', header: 'x-tenant-id' },
    requestId: { value: () => 'req-1', header: 'x-request-id' },
    traceId: { value: () => undefined, header: 'x-trace-id' },
    locale: { value: () => 'en' },
} as const;

const context = configureContext(CONFIG);
const DESTINATIONS = {
    internal: ['tenantId', 'requestId', 'traceId'],
    payments: ['requestId'],
    analytics: [],
} as const;

describe('createGetHeaders', () => {
    const getHeaders = createGetHeaders(context, CONFIG, DESTINATIONS);
    const inContext = <T>(fn: () => T) => context.run({ headers: {} }, fn);

    it('returns the header of each entry the destination lists, under its header name', () => {
        expect(inContext(() => getHeaders('internal'))).toEqual({
            'x-tenant-id': 'tenant-1',
            'x-request-id': 'req-1',
        });
        expect(inContext(() => getHeaders('payments'))).toEqual({ 'x-request-id': 'req-1' });
    });

    it('leaves out an entry without a value, and returns nothing for a destination listing none', () => {
        expect(inContext(() => getHeaders('internal'))).not.toHaveProperty('x-trace-id');
        expect(inContext(() => getHeaders('analytics'))).toEqual({});
    });

    it('returns nothing outside a context', () => {
        expect(getHeaders('internal')).toEqual({});
    });

    it('throws for a destination that was not declared', () => {
        // @ts-expect-error -- only declared destinations can be named
        expect(() => getHeaders('billing')).toThrow('Unknown destination: billing');
    });

    it('refuses, at startup, a destination listing an entry without a header', () => {
        expect(() => createGetHeaders(context, CONFIG, { partner: ['locale'] })).toThrow(
            new TypeError(
                'Destination "partner" lists "locale", which is not an entry with a header',
            ),
        );
    });

    it('refuses, at startup, a destination listing an unknown entry', () => {
        // @ts-expect-error -- only configured entries can be listed
        expect(() => createGetHeaders(context, CONFIG, { partner: ['region'] })).toThrow(
            new TypeError(
                'Destination "partner" lists "region", which is not an entry with a header',
            ),
        );
    });
});
