export type { ChildLogger, LogData, RootLogger } from './lib/shared/logger';

export {
    setupGracefulShutdown,
    type CleanupFn,
    type GracefulShutdown,
    type GracefulShutdownOptions,
} from './lib/lifecycle/gracefulShutdown';
export { createShutdownState, type ShutdownState } from './lib/lifecycle/shutdownState';
export { registerFatalHandlers } from './lib/lifecycle/fatalHandlers';

export { run, getOrgId, getRequestId, getStore, type RequestContext } from './lib/context/store';
export { ORG_ID_HEADER, REQUEST_ID_HEADER } from './lib/context/headers';
export type { ContextMiddlewareOptions } from './lib/context/resolveContext';
export { createExpressMiddleware } from './lib/context/express';
export { createKoaMiddleware } from './lib/context/koa';
export { createFetchWrapper, type FetchWrapperOptions } from './lib/context/fetchWrapper';

export {
    getTier,
    isNonProdTier,
    isProdTier,
    NON_PROD_TIER_PATTERN,
    PROD_TIER_PATTERN,
    type TierEnv,
} from './lib/tier/tier';
