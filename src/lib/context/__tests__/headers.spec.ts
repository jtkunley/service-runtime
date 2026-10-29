import { describe, it, expect } from 'vitest';
import { ORG_ID_HEADER, REQUEST_ID_HEADER } from '../headers';

describe('header names', () => {
    it('match what callers and other services send', () => {
        expect(ORG_ID_HEADER).toBe('x-org-id');
        expect(REQUEST_ID_HEADER).toBe('x-request-id');
    });
});
