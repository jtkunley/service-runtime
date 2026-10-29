export type { ChildLogger, LogData, RootLogger } from './lib/shared/logger';

export {
    setupGracefulShutdown,
    type CleanupFn,
    type GracefulShutdown,
    type GracefulShutdownOptions,
} from './lib/lifecycle/gracefulShutdown';
export {
    createShutdownState,
    type ShutdownState,
} from './lib/lifecycle/shutdownState';
export { registerFatalHandlers } from './lib/lifecycle/fatalHandlers';

export {
    run,
    getOrgId,
    getRequestId,
    getStore,
    type RequestContext,
} from './lib/context/store';
export {
    ORG_ID_HEADER,
    REQUEST_ID_HEADER,
} from './lib/context/headers';
export {
    MISSING_ORG_ERROR,
    MISSING_REQUEST_ID_WARN,
} from './lib/context/middleware/resolveContext';
export {
    createExpressMiddleware,
    type ExpressMiddlewareOptions,
} from './lib/context/middleware/express';
export {
    createKoaMiddleware,
    type KoaMiddlewareOptions,
} from './lib/context/middleware/koa';
export {
    createFetchWrapper,
    type FetchWrapperOptions,
} from './lib/context/fetchWrapper';

export {
    getTier,
    isNonProdTier,
    isProdTier,
    NON_PROD_TIER_PATTERN,
    PROD_TIER_PATTERN,
    type TierEnv,
} from './lib/tier/tier';
