import type { IncomingHttpHeaders } from 'http';
import { run } from '../store';
import {
    resolveRequestContext,
    type MiddlewareOptions,
    MISSING_CORRELATION_WARN,
} from './resolveContext';

export type { MiddlewareOptions as ExpressMiddlewareOptions };

interface Req {
    headers: IncomingHttpHeaders;
    method: string;
    url: string;
}
interface Res {
    status(code: number): { json(body: unknown): void };
}

export function createExpressMiddleware(opts: MiddlewareOptions = {}) {
    const { logger } = opts;
    return (req: Req, res: Res, next: () => void): void => {
        const { method, url: path, headers } = req;
        const result = resolveRequestContext(headers, opts);
        const { type, organizationId, correlationId } = result;
        const logData = {
            method,
            path,
            organizationId,
            correlationId,
            userAgent: headers['user-agent'],
        };

        // Always check correlation ID first — surfaces missing header even when
        // the request is also rejected, so all problems are logged in one pass.
        if (!correlationId) {
            logger?.warn(MISSING_CORRELATION_WARN, logData);
        }

        if (type === 'error') {
            const { status, error } = result;
            logger?.error(error, new Error(error), logData);
            res.status(status).json({ error });
            return;
        }

        run(result, () => next());
    };
}
