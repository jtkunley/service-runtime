export type LogData = Record<string, unknown>;

export interface ChildLogger {
    info(message: string, data: LogData): void;
    error(message: string, error: Error, data: LogData): void;
}

export interface RootLogger {
    child(module: string, action: string): ChildLogger;
    /** Writes out buffered lines; awaited, for at most a second, before the process exits. */
    flush?(): Promise<void>;
}
