import { randomUUID } from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import { describe, expect, it, vi } from 'vitest';
import { configureContext } from '../../configureContext';
import { resolveContext, type ContextMiddlewareOptions } from '../resolveContext';

const context = configureContext({
    tenantId: { value: (req) => req.headers['x-tenant-id'], required: true, log: true },
    region: { value: (req) => req.headers['x-region'], required: true },
    requestId: { value: (req) => req.headers['x-request-id'] ?? randomUUID(), log: true },
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

    it('logs a rejection with the request details and the logged values it did have', () => {
        const logger = { error: vi.fn() };
        const message = 'Missing required context value: region';

        resolve(
            { 'x-tenant-id': 'tenant-1', 'x-request-id': 'req-1', 'accept-language': 'en' },
            { logger },
        );

        expect(logger.error).toHaveBeenCalledWith(message, new Error(message), {
            method: 'POST',
            path: '/orders',
            userAgent: 'agent/1',
            missing: ['region'],
            tenantId: 'tenant-1',
            requestId: 'req-1',
        });
    });
});
