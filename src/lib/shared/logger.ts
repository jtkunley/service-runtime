export type LogData = Record<string, unknown>;

export interface ChildLogger {
    warn(message: string, data: LogData): void;
    info(message: string, data: LogData): void;
    error(message: string, error: Error, data: LogData): void;
}

export interface RootLogger {
    child(module: string, action: string): ChildLogger;
}
