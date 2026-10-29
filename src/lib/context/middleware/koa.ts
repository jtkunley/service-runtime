import type { IncomingHttpHeaders } from 'http';
import { run } from '../store';
import {
    resolveRequestContext,
    type MiddlewareOptions,
    MISSING_REQUEST_ID_WARN,
} from './resolveContext';

export type { MiddlewareOptions as KoaMiddlewareOptions };

interface Ctx {
    headers: IncomingHttpHeaders;
    method: string;
    url: string;
    status: number;
    body: unknown;
}

export function createKoaMiddleware(opts: MiddlewareOptions = {}) {
    const { logger } = opts;
    return async (ctx: Ctx, next: () => Promise<void>): Promise<void> => {
        const { method, url: path, headers } = ctx;
        const result = resolveRequestContext(headers, opts);
        const { type, orgId, requestId } = result;
        const logData = {
            method,
            path,
            orgId,
            requestId,
            userAgent: headers['user-agent'],
        };

        // Always check request ID first — surfaces missing header even when
        // the request is also rejected, so all problems are logged in one pass.
        if (!requestId) {
            logger?.warn(MISSING_REQUEST_ID_WARN, logData);
        }

        if (type === 'error') {
            const { status, error } = result;
            logger?.error(error, new Error(error), logData);
            ctx.status = status;
            ctx.body = { error };
            return;
        }

        await run(result, () => next());
    };
}
