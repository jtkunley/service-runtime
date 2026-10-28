import { getStore } from './store';
import { ORGANIZATION_ID_HEADER, CORRELATION_ID_HEADER } from './headers';

export interface FetchWrapperOptions {
    organizationId?: boolean;
    correlationId?: boolean;
}

export function createFetchWrapper(
    options: FetchWrapperOptions = {},
): typeof fetch {
    const { organizationId = true, correlationId = true } = options;

    return (input, init) => {
        const store = getStore();
        if (!store || (!organizationId && !correlationId)) {
            return globalThis.fetch(input, init);
        }

        const existing = new Headers(
            init?.headers ??
                (input instanceof Request ? input.headers : undefined),
        );
        if (organizationId) {
            existing.set(ORGANIZATION_ID_HEADER, store.organizationId);
        }
        if (correlationId) {
            existing.set(CORRELATION_ID_HEADER, store.correlationId);
        }

        return globalThis.fetch(input, { ...init, headers: existing });
    };
}
