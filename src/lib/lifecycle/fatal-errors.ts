import type { ChildLogger } from "../logging/logger.js";
import { toError } from "../logging/to-error.js";
import type { ExitCoordinator } from "./exit-coordinator.js";
import type { ProcessListener } from "./host-process.js";

export interface FatalErrorOptions {
  readonly log: ChildLogger;
  readonly exit: ExitCoordinator;
  readonly markShuttingDown: () => void;
}

export interface FatalErrorHandlers {
  readonly uncaughtException: ProcessListener;
  readonly unhandledRejection: ProcessListener;
}

/** Fatal events skip graceful cleanup: they mark the service as shutting down and exit with 1. */
export function createFatalErrorHandlers(options: FatalErrorOptions): FatalErrorHandlers {
  const handleFatal =
    (message: string): ProcessListener =>
    (failure) => {
      options.markShuttingDown();
      try {
        options.log.error(message, toError(failure), {});
      } catch {
        // The process is exiting either way; a failing logger must not prevent it.
      }
      options.exit.request(1);
    };

  return {
    uncaughtException: handleFatal("Uncaught exception, exiting"),
    unhandledRejection: handleFatal("Unhandled promise rejection, exiting"),
  };
}
