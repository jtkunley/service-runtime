import type { IncomingHttpHeaders } from 'http';
import type { ConfiguredContext, ContextConfig } from '../context/configureContext';
import type { ChildLogger } from '../shared/logger';
import { resolveContext } from './resolveContext';

/** The parts of Express's request and response it uses, so any compatible framework fits. */
export type ContextMiddleware = (
    req: { headers: IncomingHttpHeaders; method: string; originalUrl: string },
    res: { status(code: number): { json(body: unknown): void } },
    next: () => void,
) => void;

export function createExpressMiddleware<C extends ContextConfig>(
    context: ConfiguredContext<C>,
    logger: Pick<ChildLogger, 'error'>,
): ContextMiddleware {
    return (req, res, next) => {
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
