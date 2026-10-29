export type { ChildLogger, LogData, RootLogger } from './lib/shared/logger';

export {
    setupGracefulShutdown,
    type CleanupFn,
    type GracefulShutdown,
    type GracefulShutdownOptions,
} from './lib/lifecycle/gracefulShutdown';
export { createShutdownState, type ShutdownState } from './lib/lifecycle/shutdownState';
export { registerFatalHandlers } from './lib/lifecycle/fatalHandlers';

export {
    configureContext,
    type Context,
    type ContextConfig,
    type ContextEntry,
    type ContextRequest,
    type ContextSource,
    type ContextValues,
} from './lib/context/configureContext';
export type { ContextMiddlewareOptions } from './lib/middleware/resolveContext';
export { createExpressMiddleware } from './lib/middleware/express';
export { createFetchWrapper, type FetchWrapperOptions } from './lib/fetch/fetchWrapper';

export {
    getTier,
    isNonProdTier,
    isProdTier,
    NON_PROD_TIER_PATTERN,
    PROD_TIER_PATTERN,
    type TierEnv,
} from './lib/tier/tier';
