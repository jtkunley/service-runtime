import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
    configureContext,
    createExpressMiddleware,
    createFetchWrapper,
    createShutdownState,
    registerFatalHandlers,
    setupGracefulShutdown,
    type CleanupFn,
    type RootLogger,
} from '@jtkunley/service-runtime';
import { getTier, isNonProdTier, isProdTier } from '@jtkunley/service-runtime/tier';

const env = process.env;
const defaultTenantId = env['DEFAULT_TENANT_ID'];
const forceExitMs = env['FORCE_EXIT_MS'];

const context = configureContext({
    // Multi-tenancy: which tenant a request acts for, so every service scopes its data to it.
    tenantId: {
        value: (req) => defaultTenantId ?? req.headers['x-tenant-id'],
        required: true,
        forward: { header: 'x-tenant-id', to: 'internal' },
    },
    // Request threading: one ID across every service a request touches, so its logs join up.
    requestId: {
        value: (req) => req.headers['x-request-id']?.trim() || randomUUID(),
        forward: { header: 'x-request-id', to: 'all' },
    },
});

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
                ...context.getStore(),
                ...data,
            };
            process.stdout.write(`${JSON.stringify(line)}\n`);
        };
        return {
            info: (message, data) => write('info', message, data),
            warn: (message, data) => write('warn', message, data),
            error: (message, error, data) => write('error', message, data, error),
        };
    },
    // Slow on purpose, so the tests can tell the process waited for it.
    flush: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        process.stdout.write(`${JSON.stringify({ level: 'info', message: 'Logs flushed' })}\n`);
    },
};

registerFatalHandlers(rootLogger);

const log = rootLogger.child('fixture', 'service');
const state = createShutdownState();
const wrappedFetch = createFetchWrapper(context);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const app = express();

app.get('/ready', (_req, res) => {
    res.sendStatus(state.isShuttingDown() ? 503 : 200);
});
app.get('/health', (_req, res) => {
    const tier = getTier();
    res.json({ tier: tier ?? null, nonProd: isNonProdTier(tier), prod: isProdTier(tier) });
});

app.use(createExpressMiddleware(context, { logger: rootLogger.child('server', 'context') }));

app.get('/context', (_req, res) => {
    res.json(context.getStore());
});
app.get('/headers', (req, res) => {
    res.json({ tenantId: req.get('x-tenant-id'), requestId: req.get('x-request-id') });
});
app.get('/call', async (req, res) => {
    const downstream = await wrappedFetch(req.query['url'] as string);
    res.json({ context: context.getStore(), downstream: await downstream.json() });
});
app.get('/slow', async (req, res) => {
    log.info('Slow request started', {});
    await sleep(Number(req.query['ms']));
    res.json(context.getStore());
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

const cleanups: CleanupFn[] = [];
if (env['FAIL_CLEANUP']) {
    cleanups.push(function flushQueue() {
        throw new Error('queue unreachable');
    });
}
cleanups.push(function closeDatabase() {
    log.info('Database closed', {});
});

const server = createServer(app);
setupGracefulShutdown(server, rootLogger, cleanups, {
    state,
    forceExitMs: forceExitMs ? Number(forceExitMs) : undefined,
    onShutdownStart: () => sleep(Number(env['SHUTDOWN_DELAY_MS'] ?? 0)),
});
server.listen(0, '127.0.0.1', () => {
    log.info('Listening', { port: (server.address() as AddressInfo).port });
});
