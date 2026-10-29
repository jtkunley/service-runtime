import { describe, it, expect } from 'vitest';
import { toError } from '../errors';

describe('toError', () => {
    it('returns an Error as it is', () => {
        const error = new TypeError('bad');

        expect(toError(error)).toBe(error);
    });

    it.each([
        ['a string', 'failed', 'failed'],
        ['a number', 42, '42'],
        ['an object', { code: 'E_PLAIN' }, '[object Object]'],
        ['undefined', undefined, 'undefined'],
    ])('wraps %s in an Error, keeping it as the cause', (_name, value, message) => {
        const error = toError(value);

        expect(error).toEqual(new Error(message));
        expect(error.cause).toBe(value);
    });
});
