import { afterEach, describe, expect, it } from 'vitest';
import { startService, stopServices } from './service';

describe('fatal error handling in a running service', () => {
    afterEach(stopServices);

    it.each([
        ['an uncaught exception', '/throw', 'Uncaught exception, exiting', 'thrown outside any handler'],
        ['an unhandled rejection', '/reject', 'Unhandled promise rejection, exiting', 'rejected with no handler'],
    ])('logs %s and exits 1 at once, skipping graceful shutdown', async (_name, path, message, error) => {
        const service = await startService();

        await fetch(`${service.url}${path}`, { headers: { 'x-org-id': 'org-1' } });

        expect(await service.exited).toBe(1);
        expect(await service.waitForLog(message)).toMatchObject({
            level: 'error',
            module: 'server',
            action: 'fatal',
            error,
        });
        expect(service.messages()).not.toContain('Received shutdown signal, closing server...');
    });
});
