import { randomUUID } from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import { describe, expect, it, vi } from 'vitest';
import { configureContext } from '../../context/configureContext';
import { resolveContext, type ContextMiddlewareOptions } from '../resolveContext';

const context = configureContext({
    tenantId: { value: (req) => req.headers['x-tenant-id'], required: true },
    region: { value: (req) => req.headers['x-region'], required: true },
    requestId: { value: (req) => req.headers['x-request-id'] ?? randomUUID() },
    locale: { value: (req) => req.headers['accept-language'] },
});

const BOTH_REQUIRED = { 'x-tenant-id': 'tenant-1', 'x-region': 'eu' };

const resolve = (headers: IncomingHttpHeaders, opts: ContextMiddlewareOptions = {}) =>
    resolveContext(
        context,
        { headers: { 'user-agent': 'agent/1', ...headers }, method: 'POST', path: '/orders' },
        opts,
    );

describe('resolveContext', () => {
    it('hands back a way into the context holding the request’s values', () => {
        const result = resolve({ ...BOTH_REQUIRED, 'x-request-id': 'req-1' });

        expect('enter' in result && result.enter(() => context.getStore())).toEqual({
            tenantId: 'tenant-1',
            region: 'eu',
            requestId: 'req-1',
            locale: undefined,
        });
    });

    it('logs nothing for a request with every required value', () => {
        const logger = { error: vi.fn() };

        resolve(BOTH_REQUIRED, { logger });

        expect(logger.error).not.toHaveBeenCalled();
    });

    it('rejects a request missing required values, naming every one', () => {
        expect(resolve({})).toEqual({
            error: 'Missing required context values: tenantId, region',
        });
    });

    it('logs a rejection with only what the logger cannot know: method, path and missing entries', () => {
        const logger = { error: vi.fn() };
        const message = 'Missing required context value: region';

        resolve(
            { 'x-tenant-id': 'tenant-1', 'x-request-id': 'req-1', 'accept-language': 'en' },
            { logger },
        );

        expect(logger.error).toHaveBeenCalledWith(message, new Error(message), {
            method: 'POST',
            path: '/orders',
            missing: ['region'],
        });
    });
});
