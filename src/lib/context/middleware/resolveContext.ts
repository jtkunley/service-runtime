import type { IncomingHttpHeaders } from 'http';
import { ORG_ID_HEADER, REQUEST_ID_HEADER } from '../headers';

export const MISSING_ORG_ERROR = `Missing required header: ${ORG_ID_HEADER}`;
export const MISSING_REQUEST_ID_WARN = `Missing ${REQUEST_ID_HEADER} header — generated a new one`;

export interface MiddlewareLogger {
    warn(msg: string, data: Record<string, unknown>): void;
    error(msg: string, error: Error, data: Record<string, unknown>): void;
}

export interface MiddlewareOptions {
    getDefaultOrgId?: () => string | undefined;
    logger?: MiddlewareLogger;
}

interface ContextBase {
    orgId: string | undefined;
    requestId: string | undefined;
}

export type ContextResult =
    | (ContextBase & { type: 'ok'; orgId: string })
    | (ContextBase & { type: 'error'; status: 400; error: string });

export function resolveContext(
    orgId: string | undefined,
    requestId: string | undefined,
    opts: MiddlewareOptions,
): ContextResult {
    const trimmedRequestId = requestId?.trim() || undefined;
    const defaultOrgId = opts.getDefaultOrgId?.()?.trim() || undefined;

    if (defaultOrgId) {
        // Single-tenant: there is only one tenant this service can ever
        // serve, so a caller-supplied org ID that differs from the configured
        // default can't actually misroute data — proceed under the
        // configured default regardless of what the caller says.
        return {
            type: 'ok',
            orgId: defaultOrgId,
            requestId: trimmedRequestId,
        };
    }

    const trimmedOrgId = orgId?.trim() || undefined;
    // Multi-tenant: org ID must come from the caller — none means we cannot
    // determine which tenant this unit of work belongs to.
    if (!trimmedOrgId) {
        return {
            type: 'error',
            status: 400,
            error: MISSING_ORG_ERROR,
            orgId: undefined,
            requestId: trimmedRequestId,
        };
    }

    return {
        type: 'ok',
        orgId: trimmedOrgId,
        requestId: trimmedRequestId,
    };
}

export function resolveRequestContext(
    headers: IncomingHttpHeaders,
    opts: MiddlewareOptions,
): ContextResult {
    return resolveContext(
        headers[ORG_ID_HEADER] as string | undefined,
        headers[REQUEST_ID_HEADER] as string | undefined,
        opts,
    );
}
