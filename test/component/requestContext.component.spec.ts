import { afterEach, describe, expect, it } from 'vitest';
import { startService, stopServices } from './service';

const BOTH_IDS = { 'x-tenant-id': 'tenant-1', 'x-request-id': 'req-1' };

describe('request context in a running service', () => {
    afterEach(stopServices);

    it('hands each route the tenant ID and request ID from the request headers', async () => {
        const service = await startService();

        const res = await fetch(`${service.url}/context`, { headers: BOTH_IDS });

        expect(await res.json()).toEqual({ tenantId: 'tenant-1', requestId: 'req-1' });
    });

    it('rejects a request without a tenant ID with a 400, logging the reason', async () => {
        const service = await startService();

        const res = await fetch(`${service.url}/context`);

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Missing required context value: tenantId' });
        expect(await service.waitForLog('Missing required context value: tenantId')).toMatchObject({
            level: 'error',
            module: 'server',
            action: 'context',
            method: 'GET',
            path: '/context',
            missing: ['tenantId'],
        });
    });

    it('answers the health probes without needing any context values', async () => {
        const service = await startService();

        const [readiness, liveness] = await Promise.all([
            fetch(`${service.url}/readiness`),
            fetch(`${service.url}/liveness`),
        ]);

        expect([readiness.status, liveness.status]).toEqual([200, 200]);
    });

    it('makes the values available to the logger on every line inside a request', async () => {
        const service = await startService();

        await fetch(`${service.url}/slow?ms=1`, { headers: BOTH_IDS });

        expect(await service.waitForLog('Slow request started')).toMatchObject({
            tenantId: 'tenant-1',
            requestId: 'req-1',
        });
    });

    it('runs under the default tenant in single-tenant mode, whatever the request says', async () => {
        const service = await startService({ DEFAULT_TENANT_ID: 'default-tenant' });

        const res = await fetch(`${service.url}/context`, {
            headers: { 'x-tenant-id': 'other-tenant' },
        });

        expect(await res.json()).toMatchObject({ tenantId: 'default-tenant' });
    });

    it('threads both IDs on to the next service', async () => {
        const [upstream, downstream] = await Promise.all([startService(), startService()]);

        const res = await fetch(`${upstream.url}/call?url=${downstream.url}/headers`, {
            headers: BOTH_IDS,
        });

        expect(await res.json()).toMatchObject({
            downstream: { tenantId: 'tenant-1', requestId: 'req-1' },
        });
    });

    it('threads a generated request ID on to the next service', async () => {
        const [upstream, downstream] = await Promise.all([startService(), startService()]);

        const res = await fetch(`${upstream.url}/call?url=${downstream.url}/headers`, {
            headers: { 'x-tenant-id': 'tenant-1' },
        });

        const { context, downstream: received } = (await res.json()) as {
            context: { requestId: string };
            downstream: { requestId: string };
        };
        expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(received.requestId).toBe(context.requestId);
    });

    it('sends a third-party API only the values forwarded to every destination', async () => {
        const [upstream, thirdParty] = await Promise.all([
            startService(),
            startService({ DEFAULT_TENANT_ID: 'their-tenant' }),
        ]);

        const res = await fetch(`${upstream.url}/call?external=1&url=${thirdParty.url}/headers`, {
            headers: BOTH_IDS,
        });

        const { downstream } = (await res.json()) as { downstream: object };
        expect(downstream).toEqual({ requestId: 'req-1' });
    });
});
