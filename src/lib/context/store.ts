import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

type Store = { orgId: string; requestId: string };

let _als = new AsyncLocalStorage<Store>();

export function _resetForTesting(): void {
    _als = new AsyncLocalStorage<Store>();
}

export function run<T>(
    ctx: { orgId: string; requestId?: string },
    fn: () => T,
): T {
    const orgId = ctx.orgId.trim();
    // Fail loud at the boundary — an empty org ID would silently scope all
    // downstream data access to nothing or the wrong tenant.
    if (!orgId) throw new Error('orgId must not be empty');

    const store: Store = {
        orgId,
        // Use || not ?? — treats empty/blank string as absent (e.g. header present but whitespace).
        requestId: ctx.requestId?.trim() || randomUUID(),
    };
    return _als.run(store, fn);
}

export function getStore(): Store | undefined {
    return _als.getStore();
}

export function getOrgId(): string {
    const store = _als.getStore();
    if (!store) throw new Error('No request context');
    return store.orgId;
}

export function getRequestId(): string {
    const store = _als.getStore();
    if (!store) throw new Error('No request context');
    return store.requestId;
}
