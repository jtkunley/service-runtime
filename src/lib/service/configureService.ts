import {
    createServer,
    type IncomingMessage,
    type RequestListener,
    type ServerResponse,
} from 'http';
import type { AddressInfo } from 'net';
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
    /** The values every request carries, by name. */
    context: C & NoUnknownAttributes<C>;
    /** Each destination the service calls, listing the entries whose headers it receives. */
    destinations?: D & ValidDestinations<C, D>;
}

export interface ListenOptions {
    port: number;
    host?: string;
    /**
     * Answered before the app sees the request, so a probe never needs context
     * values. Readiness fails once shutdown starts; liveness never does, so the
     * orchestrator doesn't kill a process that is draining. `false` turns one off.
     */
    probes?: { readiness?: string | false; liveness?: string | false };
    /** From the first signal to the exit; past it the process exits 1. Default 30000. */
    forceExitMs?: number;
    /**
     * Runs before the server stops accepting connections, with readiness
     * already failing: behind a load balancer, resolve after its deregistration
     * delay so it stops routing here first.
     */
    onShutdownStart?: () => void | Promise<void>;
}

export interface Service<C extends ContextConfig, D extends Destinations> {
    readonly context: Pick<Context<C>, 'run' | 'get' | 'getStore'> & {
        /** The headers for a call to `destination`, from the values it lists; empty outside a request. */
        readonly getHeaders: GetHeaders<D>;
    };
    /** Express middleware that fills the context, answering `400` for a request missing a required value. */
    readonly middleware: ReturnType<typeof createExpressMiddleware>;
    readonly isShuttingDown: () => boolean;
    /** Cleanups run in the order registered, after the server has closed. */
    readonly onShutdown: (cleanup: CleanupFn) => void;
    /** Starts the server, with graceful shutdown. Resolves with the bound address. */
    readonly listen: (app: RequestListener, options: ListenOptions) => Promise<AddressInfo>;
}

const DEFAULT_PROBES = { readiness: '/readiness', liveness: '/liveness' };

let configured = false;

/**
 * Call it first at startup, before building the app: it registers the fatal
 * error handlers, so a failure while starting is caught too.
 *
 * @throws Error on a second call; the process has one set of handlers and one server.
 */
export function configureService<
    const C extends ContextConfig,
    const D extends Destinations = Record<never, never>,
>(options: ServiceOptions<C, D>): Service<C, D> {
    if (configured) {
        throw new Error('configureService can only be called once per process');
    }
    const { logger } = options;
    registerFatalHandlers(logger);
    configured = true;

    const context = configureContext<C>(options.context);
    const getHeaders = createGetHeaders(
        context,
        options.context,
        options.destinations ?? ({} as D & ValidDestinations<C, D>),
    );
    const state = createShutdownState();
    const cleanups: CleanupFn[] = [];
    let listening = false;

    const listen = async (app: RequestListener, listenOptions: ListenOptions) => {
        if (listening) {
            throw new Error('listen() can only be called once');
        }
        listening = true;
        const { port, host, probes, forceExitMs, onShutdownStart } = listenOptions;
        const { readiness, liveness } = { ...DEFAULT_PROBES, ...probes };

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

        setupGracefulShutdown(server, logger, cleanups, { state, forceExitMs, onShutdownStart });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, () => {
                server.off('error', reject);
                resolve();
            });
        });
        return server.address() as AddressInfo;
    };

    return {
        context: { ...context, getHeaders },
        middleware: createExpressMiddleware(context, { logger: logger.child('server', 'context') }),
        isShuttingDown: state.isShuttingDown,
        onShutdown: (cleanup) => {
            cleanups.push(cleanup);
        },
        listen,
    };
}
