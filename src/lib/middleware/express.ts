import type { IncomingHttpHeaders } from 'http';
import type { ConfiguredContext, ContextConfig } from '../context/configureContext';
import type { ChildLogger } from '../shared/logger';
import { resolveContext } from './resolveContext';

interface Req {
    headers: IncomingHttpHeaders;
    method: string;
    originalUrl: string;
}
interface Res {
    status(code: number): { json(body: unknown): void };
}

export function createExpressMiddleware<C extends ContextConfig>(
    context: ConfiguredContext<C>,
    logger: Pick<ChildLogger, 'error'>,
) {
    return (req: Req, res: Res, next: () => void): void => {
        const { headers, method, originalUrl } = req;
        // The full path, mount point included, without the query string, which can carry secrets such as tokens.
        const path = originalUrl.split('?')[0]!;
        const result = resolveContext(context, { headers, method, path }, logger);
        if ('error' in result) {
            res.status(400).json(result);
            return;
        }
        result.enter(next);
    };
}
