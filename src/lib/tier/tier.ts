export type TierEnv = Readonly<Record<string, string | undefined>>;

export const NON_PROD_TIER_PATTERN = '^(?:local|dev|test|qa|staging|pr\\d+)$';
export const PROD_TIER_PATTERN = '^(?:prod|production)$';

const NON_PROD_TIER = new RegExp(NON_PROD_TIER_PATTERN);
const PROD_TIER = new RegExp(PROD_TIER_PATTERN);

function normalize(tier: string | undefined): string | undefined {
    return tier?.trim().toLowerCase() || undefined;
}

export function getTier(env: TierEnv = process.env): string | undefined {
    return normalize(Object.hasOwn(env, 'TIER') ? env['TIER'] : undefined);
}

/**
 * Gate what must never reach production, such as mock adapters or an API
 * console. An unknown tier is not non-production, so it stays locked down.
 */
export function isNonProdTier(tier: string | undefined): boolean {
    const normalized = normalize(tier);
    return normalized !== undefined && NON_PROD_TIER.test(normalized);
}

/**
 * Gate what must only run in production, such as real integrations or paging.
 * An unknown tier is not production, so it never triggers them.
 */
export function isProdTier(tier: string | undefined): boolean {
    const normalized = normalize(tier);
    return normalized !== undefined && PROD_TIER.test(normalized);
}
