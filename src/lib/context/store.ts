import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

type Store = { organizationId: string; correlationId: string };

let _als = new AsyncLocalStorage<Store>();

export function _resetForTesting(): void {
    _als = new AsyncLocalStorage<Store>();
}

export function run<T>(
    ctx: { organizationId: string; correlationId?: string },
    fn: () => T,
): T {
    const organizationId = ctx.organizationId.trim();
    // Fail loud at the boundary — an empty org ID would silently scope all
    // downstream data access to nothing or the wrong tenant.
    if (!organizationId) throw new Error('organizationId must not be empty');

    const store: Store = {
        organizationId,
        // Use || not ?? — treats empty/blank string as absent (e.g. header present but whitespace).
        correlationId: ctx.correlationId?.trim() || randomUUID(),
    };
    return _als.run(store, fn);
}

export function getStore(): Store | undefined {
    return _als.getStore();
}

export function getOrganizationId(): string {
    const store = _als.getStore();
    if (!store) throw new Error('No request context');
    return store.organizationId;
}

export function getCorrelationId(): string {
    const store = _als.getStore();
    if (!store) throw new Error('No request context');
    return store.correlationId;
}
