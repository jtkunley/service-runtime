import { describe, it, expect } from 'vitest';
import { ORGANIZATION_ID_HEADER, CORRELATION_ID_HEADER } from '../headers';

describe('header names', () => {
    it('match what callers and other services send', () => {
        expect(ORGANIZATION_ID_HEADER).toBe('x-organization-id');
        expect(CORRELATION_ID_HEADER).toBe('correlation-id');
    });
});
