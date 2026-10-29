import { randomUUID } from 'node:crypto';
import express from 'express';
import { configureService, type RootLogger } from '@jtkunley/service-runtime';

const env = process.env;
const defaultTenantId = env['DEFAULT_TENANT_ID'];
const forceExitMs = env['FORCE_EXIT_MS'];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Adds the request's context values to every line, as a logger's own context injection would. */
const rootLogger: RootLogger = {
    child: (module, action) => {
        const write = (level: string, message: string, data: object, error?: Error) => {
            const line = {
                level,
                module,
                action,
                message,
                error: error?.message,
                ...service.context.getStore(),
                ...data,
            };
            process.stdout.write(`${JSON.stringify(line)}\n`);
        };
        return {
            info: (message, data) => write('info', message, data),
            error: (message, error, data) => write('error', message, data, error),
        };
    },
    // Slow on purpose, so the tests can tell the process waited for it.
    flush: async () => {
        await sleep(100);
        process.stdout.write(`${JSON.stringify({ level: 'info', message: 'Logs flushed' })}\n`);
    },
};

const service = configureService({
    logger: rootLogger,
    context: {
        // Multi-tenancy: which tenant a request acts for, so every service scopes its data to it.
        tenantId: {
            value: (req) => defaultTenantId ?? req.headers['x-tenant-id'],
            required: true,
            header: 'x-tenant-id',
        },
        // Request threading: one ID across every service a request touches, so its logs join up.
        requestId: {
            value: (req) => req.headers['x-request-id']?.trim() || randomUUID(),
            header: 'x-request-id',
        },
    },
    destinations: {
        internal: ['tenantId', 'requestId'],
        // A third party: it never learns which tenant is calling.
        payments: ['requestId'],
    },
});

type Destination = Parameters<typeof service.context.getHeaders>[0];

/** Every outgoing call goes through here, so none can leave without the context's headers. */
function serviceFetch(url: string, init: RequestInit = {}, destination: Destination = 'internal') {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(service.context.getHeaders(destination))) {
        headers.set(name, value);
    }
    return fetch(url, { ...init, headers });
}

const log = rootLogger.child('fixture', 'service');
const app = express();

app.use(service.middleware);

app.get('/context', (_req, res) => {
    res.json(service.context.getStore());
});
app.get('/headers', (req, res) => {
    res.json({ tenantId: req.get('x-tenant-id'), requestId: req.get('x-request-id') });
});
app.get('/call', async (req, res) => {
    const url = req.query['url'] as string;
    const downstream = await (req.query['to'] === 'payments'
        ? serviceFetch(url, {}, 'payments')
        : serviceFetch(url));
    res.json({ context: service.context.getStore(), downstream: await downstream.json() });
});
app.get('/slow', async (req, res) => {
    log.info('Slow request started', {});
    await sleep(Number(req.query['ms']));
    res.json(service.context.getStore());
});
app.get('/hang', () => {
    log.info('Hanging request started', {});
});
app.get('/throw', (_req, res) => {
    setTimeout(() => {
        throw new Error('thrown outside any handler');
    });
    res.sendStatus(202);
});
app.get('/reject', (_req, res) => {
    void Promise.reject(new Error('rejected with no handler'));
    res.sendStatus(202);
});

if (env['FAIL_CLEANUP']) {
    service.onShutdown(function flushQueue() {
        throw new Error('queue unreachable');
    });
}
service.onShutdown(function closeDatabase() {
    log.info('Database closed', {});
});

const { port } = await service.listen(app, {
    port: 0,
    host: '127.0.0.1',
    forceExitMs: forceExitMs ? Number(forceExitMs) : undefined,
    onShutdownStart: () => sleep(Number(env['SHUTDOWN_DELAY_MS'] ?? 0)),
});
log.info('Listening', { port });
