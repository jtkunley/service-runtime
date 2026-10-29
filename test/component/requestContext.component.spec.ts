import { afterEach, describe, expect, it } from 'vitest';
import { startService, stopServices } from './service';

const BOTH_IDS = { 'x-org-id': 'org-1', 'x-request-id': 'req-1' };

describe('request context in a running service', () => {
    afterEach(stopServices);

    it('hands each route the org ID and request ID from the request headers', async () => {
        const service = await startService();

        const res = await fetch(`${service.url}/context`, { headers: BOTH_IDS });

        expect(await res.json()).toEqual({ orgId: 'org-1', requestId: 'req-1' });
    });

    it('rejects a request without an org ID with a 400, logging the reason', async () => {
        const service = await startService();

        const res = await fetch(`${service.url}/context`);

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Missing required header: x-org-id' });
        expect(await service.waitForLog('Missing required header: x-org-id')).toMatchObject({
            level: 'error',
            module: 'server',
            action: 'context',
            method: 'GET',
            path: '/context',
        });
    });

    it('runs under the default org in single-tenant mode, whatever the request says', async () => {
        const service = await startService({ DEFAULT_ORG_ID: 'default-org' });

        const res = await fetch(`${service.url}/context`, {
            headers: { 'x-org-id': 'other-org' },
        });

        expect(await res.json()).toMatchObject({ orgId: 'default-org' });
    });

    it('threads both IDs on to the next service', async () => {
        const [upstream, downstream] = await Promise.all([startService(), startService()]);

        const res = await fetch(`${upstream.url}/call?url=${downstream.url}/headers`, {
            headers: BOTH_IDS,
        });

        expect(await res.json()).toMatchObject({
            downstream: { orgId: 'org-1', requestId: 'req-1' },
        });
    });

    it('threads a generated request ID on to the next service', async () => {
        const [upstream, downstream] = await Promise.all([startService(), startService()]);

        const res = await fetch(`${upstream.url}/call?url=${downstream.url}/headers`, {
            headers: { 'x-org-id': 'org-1' },
        });

        const { context, downstream: received } = (await res.json()) as {
            context: { requestId: string };
            downstream: { requestId: string };
        };
        expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(received.requestId).toBe(context.requestId);
    });
});
