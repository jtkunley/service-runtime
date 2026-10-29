import { afterEach, describe, expect, it } from 'vitest';
import { startService, stopServices } from './service';

describe('a cron job in a running service', () => {
    afterEach(stopServices);

    it('runs on its schedule', async () => {
        const service = await startService({ CRON_RUN_MS: '10' });

        await service.waitForLog('Heartbeat finished');

        expect(service.messages()).toContain('Cron "heartbeat" started');
    });

    it('runs each tick in its own context, and logs a failed tick with its values', async () => {
        const service = await startService({ CRON_RUN_MS: '10', CRON_FAIL: '1' });

        const started = await service.waitForLog('Heartbeat started');
        const failed = await service.waitForLog('Cron "heartbeat" run failed');

        expect(started).toMatchObject({ tenantId: 'tenant-cron', requestId: expect.any(String) });
        expect(failed).toMatchObject({
            level: 'error',
            error: 'heartbeat failed',
            tenantId: 'tenant-cron',
            requestId: started['requestId'],
        });
    });

    it('is stopped by a shutdown cleanup that waits for the run in progress', async () => {
        const service = await startService({ CRON_RUN_MS: '1500' });
        await service.waitForLog('Heartbeat started');

        service.signal('SIGTERM');

        expect(await service.exited).toBe(0);
        const messages = service.messages();
        const stoppedAt = messages.indexOf('Cron "heartbeat" stopped');
        expect(messages.slice(stoppedAt)).toEqual([
            'Cron "heartbeat" stopped',
            'Heartbeat finished',
            'Database closed',
            'Graceful shutdown complete',
        ]);
    });
});
