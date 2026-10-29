import { afterEach, describe, expect, it } from 'vitest';
import { startService, stopServices } from './service';

describe('the deployment tier in a running service', () => {
    afterEach(stopServices);

    it.each([
        [' Staging ', { tier: 'staging', nonProd: true, prod: false }],
        ['production', { tier: 'production', nonProd: false, prod: true }],
        ['sandbox', { tier: 'sandbox', nonProd: false, prod: false }],
        [undefined, { tier: null, nonProd: false, prod: false }],
    ])('reads TIER=%j from the environment', async (tier, expected) => {
        const service = await startService(tier === undefined ? {} : { TIER: tier });

        const res = await fetch(`${service.url}/tier`);

        expect(await res.json()).toEqual(expected);
    });
});
