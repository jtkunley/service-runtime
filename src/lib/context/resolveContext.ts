import type { IncomingHttpHeaders } from 'http';
import type { ChildLogger } from '../shared/logger';
import { ORG_ID_HEADER, REQUEST_ID_HEADER } from './headers';
import { normalizeId } from './store';

const MISSING_ORG_ERROR = `Missing required header: ${ORG_ID_HEADER}`;
const MISSING_REQUEST_ID_WARN = `Missing ${REQUEST_ID_HEADER} header — generated a new one`;

export interface ContextMiddlewareOptions {
    /**
     * Single-tenant: there is only one tenant this service can ever serve, so
     * a caller-supplied org ID that differs from this default can't misroute
     * data — requests run under the default regardless of the header.
     */
    getDefaultOrgId?: () => string | undefined;
    logger?: Pick<ChildLogger, 'warn' | 'error'>;
}

export interface ContextRequest {
    headers: IncomingHttpHeaders;
    method: string;
    path: string;
}

export type ResolvedContext =
    | { orgId: string; requestId: string | undefined }
    | { error: string };

/** The part of the Express and Koa middleware that does not depend on the framework. */
export function resolveContext(
    { headers, method, path }: ContextRequest,
    { getDefaultOrgId, logger }: ContextMiddlewareOptions,
): ResolvedContext {
    const requestId = normalizeId(headers[REQUEST_ID_HEADER] as string | undefined);
    // Multi-tenant: the org ID must come from the caller — none means we cannot
    // tell which tenant this unit of work belongs to.
    const orgId =
        normalizeId(getDefaultOrgId?.()) ??
        normalizeId(headers[ORG_ID_HEADER] as string | undefined);
    const logData = {
        method,
        path,
        orgId,
        requestId,
        userAgent: headers['user-agent'],
    };

    // Checked before the org ID, so a rejected request logs every problem it has in one pass.
    if (!requestId) {
        logger?.warn(MISSING_REQUEST_ID_WARN, logData);
    }
    if (!orgId) {
        logger?.error(MISSING_ORG_ERROR, new Error(MISSING_ORG_ERROR), logData);
        return { error: MISSING_ORG_ERROR };
    }
    return { orgId, requestId };
}
