import type { IncomingHttpHeaders } from 'http';
import { resolveContext, type ContextMiddlewareOptions } from './resolveContext';
import { run } from './store';

interface Ctx {
    headers: IncomingHttpHeaders;
    method: string;
    url: string;
    status: number;
    body: unknown;
}

export function createKoaMiddleware(opts: ContextMiddlewareOptions = {}) {
    return async (ctx: Ctx, next: () => Promise<void>): Promise<void> => {
        const { headers, method, url: path } = ctx;
        const result = resolveContext({ headers, method, path }, opts);
        if ('error' in result) {
            ctx.status = 400;
            ctx.body = result;
            return;
        }
        await run(result, next);
    };
}
