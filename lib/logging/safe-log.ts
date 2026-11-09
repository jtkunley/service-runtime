import type { ChildLogger, LogData } from "./logger.js";

/** Logs at info level and reports whether the logger accepted the entry without throwing. */
export function tryLogInfo(log: ChildLogger, message: string, data: LogData): boolean {
  try {
    log.info(message, data);
    return true;
  } catch {
    return false;
  }
}

/** Logs at error level and reports whether the logger accepted the entry without throwing. */
export function tryLogError(
  log: ChildLogger,
  message: string,
  error: Error,
  data: LogData,
): boolean {
  try {
    log.error(message, error, data);
    return true;
  } catch {
    return false;
  }
}
