import type { IncomingHttpHeaders } from 'http';
import type { Context, ContextConfig } from '../context/configureContext';
import { resolveContext, type ContextMiddlewareOptions } from './resolveContext';

interface Ctx {
    headers: IncomingHttpHeaders;
    method: string;
    url: string;
    status: number;
    body: unknown;
}

export function createKoaMiddleware<C extends ContextConfig>(
    context: Context<C>,
    opts: ContextMiddlewareOptions = {},
) {
    return async (ctx: Ctx, next: () => Promise<void>): Promise<void> => {
        const { headers, method, url: path } = ctx;
        const result = resolveContext(context, { headers, method, path }, opts);
        if ('error' in result) {
            ctx.status = 400;
            ctx.body = result;
            return;
        }
        await result.enter(next);
    };
}
