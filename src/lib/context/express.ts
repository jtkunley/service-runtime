import type { IncomingHttpHeaders } from 'http';
import { resolveContext, type ContextMiddlewareOptions } from './resolveContext';
import { run } from './store';

interface Req {
    headers: IncomingHttpHeaders;
    method: string;
    originalUrl: string;
}
interface Res {
    status(code: number): { json(body: unknown): void };
}

export function createExpressMiddleware(opts: ContextMiddlewareOptions = {}) {
    return (req: Req, res: Res, next: () => void): void => {
        const { headers, method, originalUrl: path } = req;
        const result = resolveContext({ headers, method, path }, opts);
        if ('error' in result) {
            res.status(400).json(result);
            return;
        }
        run(result, next);
    };
}
