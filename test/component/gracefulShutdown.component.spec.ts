import { connect } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { startService, stopServices } from './service';

const BOTH_IDS = { 'x-tenant-id': 'tenant-1', 'x-request-id': 'req-1' };
/** The service sweeps idle connections every second; the client keeps them open for 4. */
const IDLE_SWEEP_BOUND_MS = 2_000;

function connectionRefused(url: string): Promise<boolean> {
    const { hostname, port } = new URL(url);
    return new Promise((resolve) => {
        const socket = connect(Number(port), hostname);
        socket.on('connect', () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'ECONNREFUSED'));
    });
}

describe('graceful shutdown of a running service', () => {
    afterEach(stopServices);

    it('on SIGTERM, fails readiness but not liveness, finishes the in-flight request in its context, refuses new connections, cleans up, flushes the logger and exits 0', async () => {
        const service = await startService({ SHUTDOWN_DELAY_MS: '500' });
        expect((await fetch(`${service.url}/readiness`)).status).toBe(200);
        expect((await fetch(`${service.url}/liveness`)).status).toBe(200);
        const inFlight = fetch(`${service.url}/slow?ms=1000`, { headers: BOTH_IDS });
        await service.waitForLog('Slow request started');

        service.signal('SIGTERM');
        await service.waitForLog('Received shutdown signal, closing server...');

        expect((await fetch(`${service.url}/readiness`)).status).toBe(503);
        expect((await fetch(`${service.url}/liveness`)).status).toBe(200);
        expect(await (await inFlight).json()).toEqual({ tenantId: 'tenant-1', requestId: 'req-1' });
        expect(await connectionRefused(service.url)).toBe(true);
        expect(await service.exited).toBe(0);
        expect(service.messages()).toEqual(
            expect.arrayContaining([
                'Received shutdown signal, closing server...',
                'Database closed',
                'Graceful shutdown complete',
            ]),
        );
        expect(service.messages().indexOf('Database closed')).toBeLessThan(
            service.messages().indexOf('Graceful shutdown complete'),
        );
        expect(service.messages().at(-1)).toBe('Logs flushed');
    });

    it('closes the keep-alive connection soon after the last response, instead of waiting for it to time out', async () => {
        const service = await startService();
        const inFlight = fetch(`${service.url}/slow?ms=500`, { headers: BOTH_IDS });
        await service.waitForLog('Slow request started');

        service.signal('SIGTERM');
        await (await inFlight).json();
        const respondedAt = Date.now();

        expect(await service.exited).toBe(0);
        expect(Date.now() - respondedAt).toBeLessThan(IDLE_SWEEP_BOUND_MS);
    });

    it('shuts down on SIGINT too, ignoring a repeated signal', async () => {
        const service = await startService({ SHUTDOWN_DELAY_MS: '300' });

        service.signal('SIGINT');
        await service.waitForLog('Received shutdown signal, closing server...');
        service.signal('SIGTERM');

        expect(await service.exited).toBe(0);
        expect(
            await service.waitForLog('Shutdown already in progress, ignoring signal'),
        ).toMatchObject({ signal: 'SIGTERM' });
    });

    it('exits 1 naming a failing cleanup, still running the cleanups after it', async () => {
        const service = await startService({ FAIL_CLEANUP: '1' });

        service.signal('SIGTERM');

        expect(await service.exited).toBe(1);
        expect(await service.waitForLog('Error during resource cleanup')).toMatchObject({
            level: 'error',
            cleanup: 'flushQueue',
            error: 'queue unreachable',
        });
        expect(service.messages()).toContain('Database closed');
    });

    it('forces exit 1 when a request outlasts forceExitMs, once the logger has flushed', async () => {
        const service = await startService({ FORCE_EXIT_MS: '500' });
        void fetch(`${service.url}/hang`, { headers: BOTH_IDS }).catch(() => undefined);
        await service.waitForLog('Hanging request started');

        service.signal('SIGTERM');

        expect(await service.exited).toBe(1);
        expect(service.messages()).toContain('Graceful shutdown timed out, forcing exit');
        expect(service.messages()).not.toContain('Graceful shutdown complete');
        expect(service.messages().at(-1)).toBe('Logs flushed');
    });
});
