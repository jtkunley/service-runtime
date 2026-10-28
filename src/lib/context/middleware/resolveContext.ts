import type { IncomingHttpHeaders } from 'http';
import { ORGANIZATION_ID_HEADER, CORRELATION_ID_HEADER } from '../headers';

export const MISSING_ORG_ERROR = `Missing required header: ${ORGANIZATION_ID_HEADER}`;
export const MISSING_CORRELATION_WARN = `Missing ${CORRELATION_ID_HEADER} header — generated a new one`;

export interface MiddlewareLogger {
    warn(msg: string, data: Record<string, unknown>): void;
    error(msg: string, error: Error, data: Record<string, unknown>): void;
}

export interface MiddlewareOptions {
    getDefaultOrgId?: () => string | undefined;
    logger?: MiddlewareLogger;
}

interface ContextBase {
    organizationId: string | undefined;
    correlationId: string | undefined;
}

export type ContextResult =
    | (ContextBase & { type: 'ok'; organizationId: string })
    | (ContextBase & { type: 'error'; status: 400; error: string });

export function resolveContext(
    organizationId: string | undefined,
    correlationId: string | undefined,
    opts: MiddlewareOptions,
): ContextResult {
    const trimmedCorrelationId = correlationId?.trim() || undefined;
    const defaultOrgId = opts.getDefaultOrgId?.()?.trim() || undefined;

    if (defaultOrgId) {
        // Single-tenant: there is only one tenant this service can ever
        // serve, so a caller-supplied org ID that differs from the configured
        // default can't actually misroute data — proceed under the
        // configured default regardless of what the caller says.
        return {
            type: 'ok',
            organizationId: defaultOrgId,
            correlationId: trimmedCorrelationId,
        };
    }

    const trimmedOrgId = organizationId?.trim() || undefined;
    // Multi-tenant: org ID must come from the caller — none means we cannot
    // determine which tenant this unit of work belongs to.
    if (!trimmedOrgId) {
        return {
            type: 'error',
            status: 400,
            error: MISSING_ORG_ERROR,
            organizationId: undefined,
            correlationId: trimmedCorrelationId,
        };
    }

    return {
        type: 'ok',
        organizationId: trimmedOrgId,
        correlationId: trimmedCorrelationId,
    };
}

export function resolveRequestContext(
    headers: IncomingHttpHeaders,
    opts: MiddlewareOptions,
): ContextResult {
    return resolveContext(
        headers[ORGANIZATION_ID_HEADER] as string | undefined,
        headers[CORRELATION_ID_HEADER] as string | undefined,
        opts,
    );
}
