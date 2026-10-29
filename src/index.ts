export {
    configureService,
    type Service,
    type ServiceOptions,
} from './lib/service/configureService';
export type {
    ContextConfig,
    ContextEntry,
    ContextRequest,
    ContextSource,
    ContextValues,
} from './lib/context/configureContext';
export type { Destinations } from './lib/context/getHeaders';
export type { ContextMiddleware } from './lib/middleware/express';
export type { CleanupFn } from './lib/shutdown/gracefulShutdown';
export type { ChildLogger, LogData, RootLogger } from './lib/shared/logger';
