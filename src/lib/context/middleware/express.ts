import type { IncomingHttpHeaders } from 'http';
import { run } from '../store';
import {
    resolveRequestContext,
    type MiddlewareOptions,
    MISSING_REQUEST_ID_WARN,
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
            res.status(status).json({ error });
            return;
        }

        run(result, () => next());
    };
}
