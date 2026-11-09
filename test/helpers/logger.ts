import type { ChildLogger, LogData, Logger } from "../../lib/logging/logger.js";

export interface LogEntry {
  readonly scope: string;
  readonly level: "info" | "error";
  readonly message: string;
  readonly error?: Error;
  readonly data: LogData;
}

/** A logger that records every entry, with switches for simulating failures. */
export class RecordingLogger implements Logger {
  readonly entries: LogEntry[] = [];
  readonly childCalls: string[] = [];
  /** Scopes (`module/action`) whose `child()` call throws. */
  readonly failingChildren = new Set<string>();
  /** Decides whether a logging call throws after the entry is recorded. */
  throwOnLog: (entry: LogEntry) => boolean = () => false;
  flush?: () => Promise<void>;

  child(module: string, action: string): ChildLogger {
    const scope = `${module}/${action}`;
    this.childCalls.push(scope);
    if (this.failingChildren.has(scope)) throw new Error(`Logger child ${scope} unavailable`);

    return {
      info: (message, data) => {
        this.#record({ scope, level: "info", message, data });
      },
      error: (message, error, data) => {
        this.#record({ scope, level: "error", message, error, data });
      },
    };
  }

  messages(scope: string): string[] {
    return this.entries.filter((entry) => entry.scope === scope).map((entry) => entry.message);
  }

  find(message: string): LogEntry | undefined {
    return this.entries.find((entry) => entry.message === message);
  }

  #record(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.throwOnLog(entry)) throw new Error("Logger failure");
  }
}
