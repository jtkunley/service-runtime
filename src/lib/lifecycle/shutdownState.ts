/**
 * Separate from `setupGracefulShutdown` so the app can create it before the
 * server listens and wire readiness to it up front.
 */
export interface ShutdownState {
    readonly isShuttingDown: () => boolean;
    readonly begin: () => void;
}

export function createShutdownState(): ShutdownState {
    let shuttingDown = false;
    return {
        isShuttingDown: () => shuttingDown,
        begin: () => {
            shuttingDown = true;
        },
    };
}
