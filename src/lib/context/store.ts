import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface RequestContext {
    readonly orgId: string;
    readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** A blank ID counts as absent, so a header sent empty is treated as not sent. */
export function normalizeId(id: string | undefined): string | undefined {
    return id?.trim() || undefined;
}

export function run<T>(ctx: { orgId: string; requestId?: string }, fn: () => T): T {
    const orgId = normalizeId(ctx.orgId);
    // Fail loud at the boundary — an empty org ID would silently scope all
    // downstream data access to nothing or the wrong tenant.
    if (!orgId) throw new Error('orgId must not be empty');

    const context: RequestContext = Object.freeze({
        orgId,
        requestId: normalizeId(ctx.requestId) ?? randomUUID(),
    });
    return storage.run(context, fn);
}

export function getStore(): RequestContext | undefined {
    return storage.getStore();
}

export function getOrgId(): string {
    const context = storage.getStore();
    if (!context) throw new Error('No request context');
    return context.orgId;
}

export function getRequestId(): string {
    const context = storage.getStore();
    if (!context) throw new Error('No request context');
    return context.requestId;
}
