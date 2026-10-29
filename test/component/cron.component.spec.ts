import { afterEach, describe, expect, it } from 'vitest';
import { startService, stopServices } from './service';

describe('a cron job in a running service', () => {
    afterEach(stopServices);

    it('runs on its schedule', async () => {
        const service = await startService({ CRON_RUN_MS: '10' });

        await service.waitForLog('Heartbeat finished');

        expect(service.messages()).toContain('Cron "heartbeat" started');
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
