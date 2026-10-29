/** Created with the service, so `isShuttingDown` works before it listens. */
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
