export type LogData = Readonly<Record<string, unknown>>;

/** A module-scoped logger returned by {@link Logger.child}. */
export interface ChildLogger {
  info(message: string, data: LogData): void;
  error(message: string, error: Error, data: LogData): void;
}

/** The root logger supplied by the application. */
export interface Logger {
  child(module: string, action: string): ChildLogger;
  /** Called before the process exits; the runtime waits at most one second for it. */
  flush?(): Promise<void>;
}
