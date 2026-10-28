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
    getOrganizationId,
    getCorrelationId,
    getStore,
} from './lib/context/store';
export {
    ORGANIZATION_ID_HEADER,
    CORRELATION_ID_HEADER,
} from './lib/context/headers';
export {
    MISSING_ORG_ERROR,
    MISSING_CORRELATION_WARN,
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
