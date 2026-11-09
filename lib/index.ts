export { configureService } from "./configure-service.js";

export type {
  ContextDestinations,
  ContextEntries,
  ContextEntry,
  ContextRequest,
  ContextSource,
  ContextValues,
  DestinationNames,
  ServiceContext,
} from "./context/types.js";
export type { Middleware, MiddlewareRequest, NextFunction } from "./http/middleware.js";
export type { ChildLogger, LogData, Logger } from "./logging/logger.js";
export type {
  Cleanup,
  ProbeOptions,
  Service,
  ServiceOptions,
  ShutdownHook,
} from "./service/types.js";
