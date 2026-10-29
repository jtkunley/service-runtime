/** Multi-tenancy: names the tenant a request acts for, so every service scopes its data to that org. */
export const ORG_ID_HEADER = 'x-org-id' as const;
/** Request threading: one ID carried across every service a request touches, so its logs can be joined up. */
export const REQUEST_ID_HEADER = 'x-request-id' as const;
