import { getStore } from './store';
import { ORG_ID_HEADER, REQUEST_ID_HEADER } from './headers';

export interface FetchWrapperOptions {
    orgId?: boolean;
    requestId?: boolean;
}

export function createFetchWrapper(
    options: FetchWrapperOptions = {},
): typeof fetch {
    const { orgId = true, requestId = true } = options;

    return (input, init) => {
        const store = getStore();
        if (!store || (!orgId && !requestId)) {
            return globalThis.fetch(input, init);
        }

        const existing = new Headers(
            init?.headers ??
                (input instanceof Request ? input.headers : undefined),
        );
        if (orgId) {
            existing.set(ORG_ID_HEADER, store.orgId);
        }
        if (requestId) {
            existing.set(REQUEST_ID_HEADER, store.requestId);
        }

        return globalThis.fetch(input, { ...init, headers: existing });
    };
}
