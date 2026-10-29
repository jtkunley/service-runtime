import type { IncomingHttpHeaders } from 'http';
import type { ChildLogger } from '../shared/logger';
import {
    contextInternals,
    missingValuesMessage,
    toContextRequest,
    type Context,
    type ContextConfig,
} from '../context/configureContext';

export interface ContextMiddlewareOptions {
    logger?: Pick<ChildLogger, 'error'>;
}

export interface HttpRequest {
    headers: IncomingHttpHeaders;
    method: string;
    path: string;
}

export type ResolvedContext = { enter<T>(fn: () => T): T } | { error: string };

/** The part of the Express and Koa middleware that does not depend on the framework. */
export function resolveContext<C extends ContextConfig>(
    context: Context<C>,
    { headers, method, path }: HttpRequest,
    { logger }: ContextMiddlewareOptions,
): ResolvedContext {
    const { resolve, enter, logData } = contextInternals(context);
    const request = toContextRequest({ headers, method, path });
    const { values, missing } = resolve(request);
    if (missing.length === 0) {
        return { enter: (fn) => enter(values, fn) };
    }

    const error = missingValuesMessage(missing);
    logger?.error(error, new Error(error), {
        method,
        path,
        userAgent: request.headers['user-agent'],
        missing,
        ...logData(values),
    });
    return { error };
}
