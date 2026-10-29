import { describe, it, expect } from 'vitest';
import { createShutdownState } from '../shutdownState';

describe('createShutdownState', () => {
    it('is not shutting down until begun, and stays shutting down after', () => {
        const state = createShutdownState();
        expect(state.isShuttingDown()).toBe(false);

        state.begin();
        state.begin();

        expect(state.isShuttingDown()).toBe(true);
    });

    it('answers through isShuttingDown passed on its own', () => {
        const state = createShutdownState();
        const { isShuttingDown } = state;

        state.begin();

        expect(isShuttingDown()).toBe(true);
    });

    it('keeps each state separate', () => {
        const first = createShutdownState();
        const second = createShutdownState();

        first.begin();

        expect(second.isShuttingDown()).toBe(false);
    });
});
