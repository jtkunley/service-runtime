import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFetchWrapper } from '../fetchWrapper';
import { run, _resetForTesting } from '../store';
import { ORG_ID_HEADER, REQUEST_ID_HEADER } from '../headers';

const URL_ = 'https://example.com/api';
const CTX = { orgId: 'ctx-org', requestId: 'ctx-corr' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    _resetForTesting();
    fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** The request fetch was asked for, resolved the way fetch itself resolves it. */
const sentRequest = (): Request => {
    const [input, init] = fetchMock.mock.calls[0] as [
        string | URL | Request,
        RequestInit?,
    ];
    return new Request(input, init);
};

describe('createFetchWrapper', () => {
    it('returns the response from the global fetch, looked up at call time', async () => {
        const fetchWrapper = createFetchWrapper();
        const response = new Response('later');
        const laterFetch = vi.fn().mockResolvedValue(response);
        vi.stubGlobal('fetch', laterFetch);

        await expect(fetchWrapper(URL_)).resolves.toBe(response);
        expect(laterFetch).toHaveBeenCalledOnce();
    });

    it('passes the call through untouched outside a request context', async () => {
        const init = { headers: { 'x-custom': 'value' } };

        await createFetchWrapper()(URL_, init);

        expect(fetchMock).toHaveBeenCalledWith(URL_, init);
    });

    it('passes the call through untouched when both headers are turned off', async () => {
        const fetchWrapper = createFetchWrapper({
            orgId: false,
            requestId: false,
        });
        const init = { headers: { 'x-custom': 'value' } };

        await run(CTX, () => fetchWrapper(URL_, init));

        expect(fetchMock).toHaveBeenCalledWith(URL_, init);
    });

    it('replaces caller-provided context headers with the context values', async () => {
        await run(CTX, () =>
            createFetchWrapper()(URL_, {
                headers: {
                    [ORG_ID_HEADER]: 'caller-org',
                    [REQUEST_ID_HEADER]: 'caller-corr',
                },
            }),
        );

        expect(sentRequest().headers.get(ORG_ID_HEADER)).toBe('ctx-org');
        expect(sentRequest().headers.get(REQUEST_ID_HEADER)).toBe('ctx-corr');
    });

    it('never changes the headers the caller passed in', async () => {
        const headers = new Headers({ 'x-custom': 'value' });

        await run(CTX, () => createFetchWrapper()(URL_, { headers }));

        expect([...headers.keys()]).toEqual(['x-custom']);
    });

    it('keeps a Request input’s method and body', async () => {
        await run(CTX, () =>
            createFetchWrapper()(
                new Request(URL_, { method: 'POST', body: 'payload' }),
            ),
        );

        const request = sentRequest();
        expect(request.method).toBe('POST');
        expect(await request.text()).toBe('payload');
        expect(request.headers.get(ORG_ID_HEADER)).toBe('ctx-org');
    });

    it('lets init.headers win over a Request input’s headers, like fetch itself', async () => {
        await run(CTX, () =>
            createFetchWrapper()(
                new Request(URL_, { headers: { 'x-from': 'request' } }),
                { headers: { 'x-from': 'init' } },
            ),
        );

        expect(sentRequest().headers.get('x-from')).toBe('init');
    });

    describe.each([
        { name: 'by default', options: {}, org: 'ctx-org', corr: 'ctx-corr' },
        {
            name: 'with orgId off',
            options: { orgId: false },
            org: null,
            corr: 'ctx-corr',
        },
        {
            name: 'with requestId off',
            options: { requestId: false },
            org: 'ctx-org',
            corr: null,
        },
    ])('$name', ({ options, org, corr }) => {
        const sources: [string, () => [string | URL | Request, RequestInit?]][] = [
            ['no init', () => [URL_]],
            ['an init.headers object', () => [URL_, { headers: { authorization: 'Bearer t' } }]],
            ['an init.headers Headers', () => [URL_, { headers: new Headers({ authorization: 'Bearer t' }) }]],
            ['init.headers tuples', () => [URL_, { headers: [['authorization', 'Bearer t']] }]],
            ['a Request', () => [new Request(URL_, { headers: { authorization: 'Bearer t' } })]],
            ['a Request with an empty init', () => [new Request(URL_, { headers: { authorization: 'Bearer t' } }), {}]],
            ['a URL with init.headers', () => [new URL(URL_), { headers: { authorization: 'Bearer t' } }]],
        ];

        it.each(sources)(
            'sends the context headers and keeps the caller’s, given %s',
            async (source, args) => {
                await run(CTX, () => createFetchWrapper(options)(...args()));

                const { headers } = sentRequest();
                expect(headers.get(ORG_ID_HEADER)).toBe(org);
                expect(headers.get(REQUEST_ID_HEADER)).toBe(corr);
                expect(headers.get('authorization')).toBe(
                    source === 'no init' ? null : 'Bearer t',
                );
            },
        );
    });

    const callerOrgSources: [string, () => [string | URL | Request, RequestInit?]][] = [
        ['an init.headers object', () => [URL_, { headers: { [ORG_ID_HEADER]: 'caller-org' } }]],
        ['a Request', () => [new Request(URL_, { headers: { [ORG_ID_HEADER]: 'caller-org' } })]],
    ];

    it.each(callerOrgSources)(
        'leaves a caller’s own org ID header alone when orgId is off, given %s',
        async (_source, args) => {
            await run(CTX, () =>
                createFetchWrapper({ orgId: false })(...args()),
            );

            expect(sentRequest().headers.get(ORG_ID_HEADER)).toBe(
                'caller-org',
            );
        },
    );
});
