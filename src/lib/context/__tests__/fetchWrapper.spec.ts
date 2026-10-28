import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFetchWrapper } from '../fetchWrapper';
import { run, _resetForTesting } from '../store';
import { ORGANIZATION_ID_HEADER, CORRELATION_ID_HEADER } from '../headers';

beforeEach(() => {
    _resetForTesting();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
});
afterEach(() => vi.unstubAllGlobals());

describe('createFetchWrapper', () => {
    it('delegates to globalThis.fetch', async () => {
        const fetchWrapper = createFetchWrapper();
        await fetchWrapper('https://example.com/api');
        expect(globalThis.fetch).toHaveBeenCalledOnce();
    });

    it('injects org and correlation headers from context', async () => {
        const fetchWrapper = createFetchWrapper();
        await run({ organizationId: 'org-1', correlationId: 'corr-1' }, () =>
            fetchWrapper('https://example.com/api'),
        );
        const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
            .calls[0]!;
        const headers = new Headers(init?.headers);
        expect(headers.get(ORGANIZATION_ID_HEADER)).toBe('org-1');
        expect(headers.get(CORRELATION_ID_HEADER)).toBe('corr-1');
    });

    it('does not inject headers when called outside context', async () => {
        const fetchWrapper = createFetchWrapper();
        await fetchWrapper('https://example.com/api');
        const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
            .calls[0]!;
        const headers = new Headers(init?.headers);
        expect(headers.get(ORGANIZATION_ID_HEADER)).toBeNull();
        expect(headers.get(CORRELATION_ID_HEADER)).toBeNull();
    });

    it('overrides caller-provided context headers with context values', async () => {
        const fetchWrapper = createFetchWrapper();
        await run(
            { organizationId: 'ctx-org', correlationId: 'ctx-corr' },
            () =>
                fetchWrapper('https://example.com/api', {
                    headers: {
                        [ORGANIZATION_ID_HEADER]: 'caller-org',
                        [CORRELATION_ID_HEADER]: 'caller-corr',
                    },
                }),
        );
        const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
            .calls[0]!;
        const headers = new Headers(init?.headers);
        expect(headers.get(ORGANIZATION_ID_HEADER)).toBe('ctx-org');
        expect(headers.get(CORRELATION_ID_HEADER)).toBe('ctx-corr');
    });

    it('works when init.headers is a Headers instance', async () => {
        const fetchWrapper = createFetchWrapper();
        const existingHeaders = new Headers({ 'x-custom': 'value' });
        await run({ organizationId: 'org-1', correlationId: 'corr-1' }, () =>
            fetchWrapper('https://example.com/api', {
                headers: existingHeaders,
            }),
        );
        const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
            .calls[0]!;
        const headers = new Headers(init?.headers);
        expect(headers.get('x-custom')).toBe('value');
        expect(headers.get(ORGANIZATION_ID_HEADER)).toBe('org-1');
        expect(headers.get(CORRELATION_ID_HEADER)).toBe('corr-1');
    });

    it('preserves existing headers on the request', async () => {
        const fetchWrapper = createFetchWrapper();
        await run({ organizationId: 'org-1', correlationId: 'corr-1' }, () =>
            fetchWrapper('https://example.com/api', {
                headers: { 'x-custom': 'value' },
            }),
        );
        const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
            .calls[0]!;
        const headers = new Headers(init?.headers);
        expect(headers.get('x-custom')).toBe('value');
        expect(headers.get(ORGANIZATION_ID_HEADER)).toBe('org-1');
    });

    describe('options', () => {
        const sentHeaders = () =>
            new Headers(
                (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]
                    ?.headers,
            );

        it('skips org header when organizationId is false', async () => {
            const fetchWrapper = createFetchWrapper({ organizationId: false });
            await run(
                { organizationId: 'org-1', correlationId: 'corr-1' },
                () => fetchWrapper('https://example.com/api'),
            );
            expect(sentHeaders().get(ORGANIZATION_ID_HEADER)).toBeNull();
            expect(sentHeaders().get(CORRELATION_ID_HEADER)).toBe('corr-1');
        });

        it('skips correlation header when correlationId is false', async () => {
            const fetchWrapper = createFetchWrapper({ correlationId: false });
            await run(
                { organizationId: 'org-1', correlationId: 'corr-1' },
                () => fetchWrapper('https://example.com/api'),
            );
            expect(sentHeaders().get(ORGANIZATION_ID_HEADER)).toBe('org-1');
            expect(sentHeaders().get(CORRELATION_ID_HEADER)).toBeNull();
        });

        it('passes init through untouched when both are disabled', async () => {
            const fetchWrapper = createFetchWrapper({
                organizationId: false,
                correlationId: false,
            });
            const init = { headers: { 'x-custom': 'value' } };
            await run(
                { organizationId: 'org-1', correlationId: 'corr-1' },
                () => fetchWrapper('https://example.com/api', init),
            );
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'https://example.com/api',
                init,
            );
        });

        it('leaves a caller-provided org header alone when organizationId is false', async () => {
            const fetchWrapper = createFetchWrapper({ organizationId: false });
            await run(
                { organizationId: 'ctx-org', correlationId: 'corr-1' },
                () =>
                    fetchWrapper('https://example.com/api', {
                        headers: { [ORGANIZATION_ID_HEADER]: 'caller-org' },
                    }),
            );
            expect(sentHeaders().get(ORGANIZATION_ID_HEADER)).toBe(
                'caller-org',
            );
        });
    });

    describe('caller header sources', () => {
        const URL_ = 'https://example.com/api';
        const ctx = { organizationId: 'ctx-org', correlationId: 'ctx-corr' };

        const sent = () => {
            const [input, init] = (globalThis.fetch as ReturnType<typeof vi.fn>)
                .mock.calls[0]!;
            return new Request(input, init).headers;
        };

        const sources: [string, () => [string | URL | Request, RequestInit?]][] = [
            [
                'init.headers object',
                () => [URL_, { headers: { authorization: 'Bearer t' } }],
            ],
            [
                'init.headers Headers',
                () => [
                    URL_,
                    { headers: new Headers({ authorization: 'Bearer t' }) },
                ],
            ],
            [
                'init.headers tuples',
                () => [URL_, { headers: [['authorization', 'Bearer t']] }],
            ],
            [
                'Request headers',
                () => [
                    new Request(URL_, {
                        headers: { authorization: 'Bearer t' },
                    }),
                ],
            ],
            [
                'Request headers with empty init',
                () => [
                    new Request(URL_, {
                        headers: { authorization: 'Bearer t' },
                    }),
                    {},
                ],
            ],
            [
                'URL object with init.headers',
                () => [
                    new URL(URL_),
                    { headers: { authorization: 'Bearer t' } },
                ],
            ],
        ];

        const configs = [
            { name: 'default', options: {}, org: 'ctx-org', corr: 'ctx-corr' },
            {
                name: 'organizationId false',
                options: { organizationId: false },
                org: null,
                corr: 'ctx-corr',
            },
            {
                name: 'correlationId false',
                options: { correlationId: false },
                org: 'ctx-org',
                corr: null,
            },
            {
                name: 'both false',
                options: { organizationId: false, correlationId: false },
                org: null,
                corr: null,
            },
        ];

        describe.each(configs)('$name', ({ options, org, corr }) => {
            it.each(sources)(
                'keeps caller headers from %s',
                async (_, args) => {
                    const fetchWrapper = createFetchWrapper(options);
                    await run(ctx, () => fetchWrapper(...args()));
                    const headers = sent();
                    expect(headers.get('authorization')).toBe('Bearer t');
                    expect(headers.get(ORGANIZATION_ID_HEADER)).toBe(org);
                    expect(headers.get(CORRELATION_ID_HEADER)).toBe(corr);
                },
            );
        });

        it('keeps a caller org header on a Request when organizationId is false', async () => {
            const fetchWrapper = createFetchWrapper({ organizationId: false });
            await run(ctx, () =>
                fetchWrapper(
                    new Request(URL_, {
                        headers: { [ORGANIZATION_ID_HEADER]: 'caller-org' },
                    }),
                ),
            );
            expect(sent().get(ORGANIZATION_ID_HEADER)).toBe('caller-org');
        });

        it('lets init.headers win over Request headers, like native fetch', async () => {
            const fetchWrapper = createFetchWrapper();
            await run(ctx, () =>
                fetchWrapper(
                    new Request(URL_, { headers: { 'x-from': 'request' } }),
                    { headers: { 'x-from': 'init' } },
                ),
            );
            expect(sent().get('x-from')).toBe('init');
        });

        it('preserves Request method and body', async () => {
            const fetchWrapper = createFetchWrapper();
            await run(ctx, () =>
                fetchWrapper(
                    new Request(URL_, {
                        method: 'POST',
                        body: 'payload',
                        headers: { authorization: 'Bearer t' },
                    }),
                ),
            );
            const [input, init] = (globalThis.fetch as ReturnType<typeof vi.fn>)
                .mock.calls[0]!;
            const req = new Request(input, init);
            expect(req.method).toBe('POST');
            expect(await req.text()).toBe('payload');
            expect(req.headers.get('authorization')).toBe('Bearer t');
        });
    });
});
