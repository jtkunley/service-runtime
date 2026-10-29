import {
    createServer,
    type IncomingMessage,
    type RequestListener,
    type ServerResponse,
} from 'http';
import type { AddressInfo } from 'net';
import { constants } from 'os';
import {
    configureContext,
    type Context,
    type ContextConfig,
    type NoUnknownAttributes,
} from '../context/configureContext';
import {
    createGetHeaders,
    type Destinations,
    type GetHeaders,
    type ValidDestinations,
} from '../context/getHeaders';
import { registerFatalHandlers } from '../fatal/fatalHandlers';
import { createExpressMiddleware } from '../middleware/express';
import type { RootLogger } from '../shared/logger';
import { setupGracefulShutdown, type CleanupFn } from '../shutdown/gracefulShutdown';
import { createShutdownState } from '../shutdown/shutdownState';

export interface ServiceOptions<C extends ContextConfig, D extends Destinations> {
    logger: RootLogger;
    /** `0` picks a free one. */
    port: number;
    /** All interfaces by default. */
    host?: string;
    /**
     * Answered before the app sees the request, so a probe never needs context
     * values. Readiness fails once shutdown starts; liveness never does, so the
     * orchestrator doesn't kill a process that is draining. `false` turns one off.
     */
    probes?: { readiness?: string | false; liveness?: string | false };
    /** The values every request carries, by name. None by default. */
    context?: C & NoUnknownAttributes<C>;
    /** Each destination the service calls, listing the entries whose headers it receives. */
    destinations?: D & ValidDestinations<C, D>;
    /**
     * Run in order on shutdown, after the server has closed: what produces work
     * first, then the clients it uses. Each is called only then, so it may close
     * a resource opened after the service is configured.
     */
    cleanups?: readonly CleanupFn[];
    /**
     * How long an idle keep-alive connection stays open. Longer than a load
     * balancer's own idle timeout (60s for AWS ALB and nginx), or the balancer
     * can send a request on a connection Node is closing, and answer 502. Default 65000.
     */
    keepAliveTimeoutMs?: number;
    /**
     * The signals that start graceful shutdown. Default SIGTERM, which
     * orchestrators send, and SIGINT, which Ctrl+C sends.
     */
    shutdownSignals?: readonly NodeJS.Signals[];
    /**
     * From the first signal to the exit; past it the process exits 1, after up
     * to a second for the logger to flush. Default 30000.
     */
    forceExitMs?: number;
    /**
     * Runs before the server stops accepting connections, with readiness
     * already failing: behind a load balancer, resolve after its deregistration
     * delay so it stops routing here first.
     */
    onShutdownStart?: () => void | Promise<void>;
}

export interface Service<C extends ContextConfig, D extends Destinations> {
    readonly context: Context<C> & {
        /** The headers for a call to `destination`, from the values it lists; empty outside a request. */
        readonly getHeaders: GetHeaders<D>;
    };
    /** Express middleware that fills the context, answering `400` for a request missing a required value. */
    readonly middleware: ReturnType<typeof createExpressMiddleware>;
    readonly isShuttingDown: () => boolean;
    /**
     * Registers the fatal error handlers, then starts the server with graceful
     * shutdown. Resolves with the bound address. One service per process listens.
     */
    readonly listen: (app: RequestListener) => Promise<AddressInfo>;
}

const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
const UNCATCHABLE_SIGNALS: readonly string[] = ['SIGKILL', 'SIGSTOP'];
const READINESS_PATH = '/readiness';
const LIVENESS_PATH = '/liveness';

// The process has one set of signal and fatal handlers, so one server.
let listening = false;

/**
 * Touches nothing process-wide until `listen`, so app code that imports the
 * service can be tested without it exiting the test process.
 *
 * @throws RangeError for a `keepAliveTimeoutMs` or `forceExitMs` that isn't a positive
 * integer, or `shutdownSignals` that are empty or include one the process can't catch.
 */
export function configureService<
    const C extends ContextConfig = Record<never, never>,
    const D extends Destinations = Record<never, never>,
>(options: ServiceOptions<C, D>): Service<C, D> {
    const {
        logger,
        port,
        host,
        probes,
        keepAliveTimeoutMs = KEEP_ALIVE_TIMEOUT_MS,
        shutdownSignals = SHUTDOWN_SIGNALS,
        forceExitMs,
        onShutdownStart,
    } = options;
    for (const [name, value] of Object.entries({ keepAliveTimeoutMs, forceExitMs })) {
        if (value !== undefined && !(Number.isInteger(value) && value > 0)) {
            throw new RangeError(`${name} must be a positive integer`);
        }
    }
    if (shutdownSignals.length === 0) {
        throw new RangeError('shutdownSignals must include at least one signal');
    }
    for (const signal of shutdownSignals) {
        if (!(signal in constants.signals) || UNCATCHABLE_SIGNALS.includes(signal)) {
            throw new RangeError(`${signal} is not a signal the process can catch`);
        }
    }
    const config = options.context ?? ({} as C & NoUnknownAttributes<C>);

    const context = configureContext<C>(config);
    const getHeaders = createGetHeaders(
        context,
        config,
        options.destinations ?? ({} as D & ValidDestinations<C, D>),
    );
    const state = createShutdownState();
    const cleanups = [...(options.cleanups ?? [])];

    const listen = async (app: RequestListener) => {
        if (listening) {
            throw new Error('Only one service can listen per process');
        }
        listening = true;
        registerFatalHandlers(logger);
        // An unset path, such as from a missing environment variable, keeps the default;
        // only `false` turns a probe off.
        const readiness = probes?.readiness ?? READINESS_PATH;
        const liveness = probes?.liveness ?? LIVENESS_PATH;

        const respond = (res: ServerResponse, status: number) => {
            res.statusCode = status;
            res.end();
        };
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
            const path = req.url?.split('?')[0];
            if (req.method === 'GET' || req.method === 'HEAD') {
                if (readiness && path === readiness) {
                    return respond(res, state.isShuttingDown() ? 503 : 200);
                }
                if (liveness && path === liveness) return respond(res, 200);
            }
            app(req, res);
        });
        server.keepAliveTimeout = keepAliveTimeoutMs;
        // Node requires the headers timeout to outlast keep-alive, and the request timeout to outlast both.
        server.headersTimeout = keepAliveTimeoutMs + 1_000;
        server.requestTimeout = Math.max(server.requestTimeout, server.headersTimeout);

        setupGracefulShutdown(server, logger, cleanups, {
            state,
            signals: shutdownSignals,
            forceExitMs,
            onShutdownStart,
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, () => {
                server.off('error', reject);
                resolve();
            });
        });
        return server.address() as AddressInfo;
    };

    const { run, get, getStore } = context;
    return {
        context: { run, get, getStore, getHeaders },
        middleware: createExpressMiddleware(context, logger.child('server', 'context')),
        isShuttingDown: state.isShuttingDown,
        listen,
    };
}
