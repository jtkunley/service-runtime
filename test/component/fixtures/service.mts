import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
    createExpressMiddleware,
    createFetchWrapper,
    createShutdownState,
    getStore,
    registerFatalHandlers,
    setupGracefulShutdown,
    type CleanupFn,
    type RootLogger,
} from '@jtkunley/service-runtime';
import { createCron } from '@jtkunley/service-runtime/cron';
import { getTier, isNonProdTier, isProdTier } from '@jtkunley/service-runtime/tier';

const env = process.env;
const defaultOrgId = env['DEFAULT_ORG_ID'];
const cronRunMs = env['CRON_RUN_MS'];
const forceExitMs = env['FORCE_EXIT_MS'];

const rootLogger: RootLogger = {
    child: (module, action) => {
        const write = (level: string, message: string, data: object, error?: Error) => {
            const line = { level, module, action, message, error: error?.message, ...data };
            process.stdout.write(`${JSON.stringify(line)}\n`);
        };
        return {
            info: (message, data) => write('info', message, data),
            warn: (message, data) => write('warn', message, data),
            error: (message, error, data) => write('error', message, data, error),
        };
    },
};

registerFatalHandlers(rootLogger);

const log = rootLogger.child('fixture', 'service');
const state = createShutdownState();
const wrappedFetch = createFetchWrapper();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const app = express();

app.get('/ready', (_req, res) => {
    res.sendStatus(state.isShuttingDown() ? 503 : 200);
});
app.get('/health', (_req, res) => {
    const tier = getTier();
    res.json({ tier: tier ?? null, nonProd: isNonProdTier(tier), prod: isProdTier(tier) });
});

app.use(
    createExpressMiddleware({
        logger: rootLogger.child('server', 'context'),
        getDefaultOrgId: defaultOrgId ? () => defaultOrgId : undefined,
    }),
);

app.get('/context', (_req, res) => {
    res.json(getStore());
});
app.get('/headers', (req, res) => {
    res.json({ orgId: req.get('x-org-id'), requestId: req.get('x-request-id') });
});
app.get('/call', async (req, res) => {
    const downstream = await wrappedFetch(req.query['url'] as string);
    res.json({ context: getStore(), downstream: await downstream.json() });
});
app.get('/slow', async (req, res) => {
    log.info('Slow request started', {});
    await sleep(Number(req.query['ms']));
    res.json(getStore());
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
if (cronRunMs) {
    const heartbeat = createCron({
        name: 'heartbeat',
        schedule: '* * * * * *',
        logger: log,
        run: async () => {
            log.info('Heartbeat started', {});
            await sleep(Number(cronRunMs));
            log.info('Heartbeat finished', {});
        },
    });
    heartbeat.start();
    cleanups.push(function stopHeartbeat() {
        return heartbeat.stop();
    });
}
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
