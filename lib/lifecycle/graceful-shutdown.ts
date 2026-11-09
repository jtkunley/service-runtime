import type { ChildLogger, LogData } from "../logging/logger.js";
import { tryLogError, tryLogInfo } from "../logging/safe-log.js";
import { toError } from "../logging/to-error.js";
import type { Cleanup, ShutdownHook } from "../service/types.js";
import type { ExitCoordinator } from "./exit-coordinator.js";

export interface GracefulShutdownOptions {
  readonly closeServer: () => Promise<void>;
  readonly log: ChildLogger;
  readonly exit: ExitCoordinator;
  readonly onShutdownStart: ShutdownHook | undefined;
  readonly cleanups: readonly Cleanup[];
  readonly forceExitMs: number;
  readonly markShuttingDown: () => void;
}

interface ShutdownStep {
  readonly failureMessage: string;
  readonly run: () => unknown;
}

/** Returns the signal handler; only the first signal starts the shutdown sequence. */
export function createGracefulShutdown(
  options: GracefulShutdownOptions,
): (signal: NodeJS.Signals) => void {
  let sequence: ShutdownSequence | undefined;

  return (signal) => {
    if (sequence !== undefined || options.exit.requested) {
      const logged = tryLogInfo(options.log, "Shutdown already in progress, ignoring signal", {
        signal,
      });
      if (!logged) sequence?.recordFailure();
      return;
    }
    sequence = new ShutdownSequence(options, signal);
    void sequence.run();
  };
}

/**
 * Runs the hook, server closure, and cleanups in order under one deadline.
 * Failures are logged and remembered so the exit code reflects them; they never stop the sequence.
 * Once any exit is selected (deadline expiry or a fatal error), no further steps start.
 */
class ShutdownSequence {
  readonly #options: GracefulShutdownOptions;
  readonly #data: LogData;
  #failed = false;

  constructor(options: GracefulShutdownOptions, signal: NodeJS.Signals) {
    this.#options = options;
    this.#data = { signal };
  }

  async run(): Promise<void> {
    const { exit, forceExitMs } = this.#options;
    this.#options.markShuttingDown();
    this.#info("Received shutdown signal, closing server...");
    const deadline = setTimeout(() => {
      this.#expire();
    }, forceExitMs);

    for (const step of shutdownSteps(this.#options)) {
      if (exit.requested) break;
      await this.#attempt(step);
    }
    clearTimeout(deadline);
    if (exit.requested) return;

    this.#info("Graceful shutdown complete");
    exit.request(this.#failed ? 1 : 0);
  }

  /** Marks the shutdown unsuccessful, raising the exit code if the final flush is already pending. */
  recordFailure(): void {
    this.#failed = true;
    if (this.#options.exit.requested) this.#options.exit.request(1);
  }

  #expire(): void {
    this.#reportFailure(
      "Graceful shutdown timed out, forcing exit",
      new Error(`Graceful shutdown did not complete within ${this.#options.forceExitMs}ms`),
    );
    this.#options.exit.request(1);
  }

  async #attempt({ failureMessage, run }: ShutdownStep): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.#reportFailure(failureMessage, toError(error));
    }
  }

  #info(message: string): void {
    if (!tryLogInfo(this.#options.log, message, this.#data)) this.recordFailure();
  }

  #reportFailure(message: string, error: Error): void {
    this.recordFailure();
    tryLogError(this.#options.log, message, error, this.#data);
  }
}

function shutdownSteps(options: GracefulShutdownOptions): ShutdownStep[] {
  const { onShutdownStart, closeServer, cleanups } = options;
  const steps: ShutdownStep[] = [];

  if (onShutdownStart) {
    steps.push({ failureMessage: "Error in onShutdownStart", run: onShutdownStart });
  }
  steps.push({ failureMessage: "Error closing server", run: closeServer });
  cleanups.forEach((cleanup, index) => {
    steps.push({
      failureMessage: `Error during resource cleanup: ${cleanup.name || `#${index + 1}`}`,
      run: cleanup,
    });
  });

  return steps;
}
