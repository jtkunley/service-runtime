export { configureService } from "./lib/configure-service.js";

export type {
  ContextDestinations,
  ContextEntries,
  ContextEntry,
  ContextRequest,
  ContextSource,
  ContextValues,
  DestinationNames,
  GetHeadersArgs,
  ServiceContext,
} from "./lib/context/types.js";
export type { Middleware, MiddlewareRequest, NextFunction } from "./lib/http/middleware.js";
export type { ChildLogger, LogData, Logger } from "./lib/logging/logger.js";
export type {
  Cleanup,
  ProbeOptions,
  Service,
  ServiceOptions,
  ShutdownHook,
} from "./lib/service/types.js";
