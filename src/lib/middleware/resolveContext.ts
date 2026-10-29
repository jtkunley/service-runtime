import type { IncomingHttpHeaders } from 'http';
import type { ChildLogger } from '../shared/logger';
import {
    missingValuesMessage,
    toContextRequest,
    type ConfiguredContext,
    type ContextConfig,
} from '../context/configureContext';

export interface HttpRequest {
    headers: IncomingHttpHeaders;
    method: string;
    path: string;
}

export type ResolvedContext = { enter<T>(fn: () => T): T } | { error: string };

/** The part of the middleware that does not depend on the framework, so another adapter is a few lines. */
export function resolveContext<C extends ContextConfig>(
    context: ConfiguredContext<C>,
    { headers, method, path }: HttpRequest,
    logger: Pick<ChildLogger, 'error'>,
): ResolvedContext {
    const { values, missing } = context.resolve(toContextRequest({ headers, method, path }));
    if (missing.length === 0) {
        return { enter: (fn) => context.enter(values, fn) };
    }

    const error = missingValuesMessage(missing);
    // Only what the logger can't know: the request never entered a context, so
    // none of its values reach the logger's own context injection.
    logger.error(error, new Error(error), { method, path, missing });
    return { error };
}
