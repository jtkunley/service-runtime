import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureContext } from '../../context/configureContext';
import { createFetchWrapper, type FetchWrapperOptions } from '../fetchWrapper';

const URL_ = 'https://example.com/api';

const context = configureContext({
    tenantId: {
        value: (req) => req.headers['x-tenant-id'],
        forward: { header: 'x-tenant-id', to: 'internal' },
    },
    requestId: {
        value: (req) => req.headers['x-request-id'],
        forward: { header: 'x-request-id', to: 'all' },
    },
    traceId: {
        value: (req) => req.headers['x-trace-id'],
        forward: { header: 'x-trace-id', to: 'all' },
    },
    userId: { value: (req) => req.headers['x-user-id'] },
});

const inContext = <T>(fn: () => T): T =>
    context.run(
        { headers: { 'x-tenant-id': 'ctx-tenant', 'x-request-id': 'ctx-req', 'x-user-id': 'u-1' } },
        fn,
    );

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** The request fetch was asked for, resolved the way fetch itself resolves it. */
const sentRequest = (): Request => {
    const [input, init] = fetchMock.mock.calls[0] as [string | URL | Request, RequestInit?];
    return new Request(input, init);
};

describe('createFetchWrapper', () => {
    it('returns the response from the global fetch, looked up at call time', async () => {
        const fetchWrapper = createFetchWrapper(context);
        const response = new Response('later');
        const laterFetch = vi.fn().mockResolvedValue(response);
        vi.stubGlobal('fetch', laterFetch);

        await expect(fetchWrapper(URL_)).resolves.toBe(response);
        expect(laterFetch).toHaveBeenCalledOnce();
    });

    it('passes the call through untouched outside a request context', async () => {
        const init = { headers: { 'x-custom': 'value' } };

        await createFetchWrapper(context)(URL_, init);

        expect(fetchMock).toHaveBeenCalledWith(URL_, init);
    });

    it('passes the call through untouched when no entry is forwarded', async () => {
        const unforwarded = configureContext({ userId: { value: () => 'u-1' } });
        const init = { headers: { 'x-custom': 'value' } };

        await unforwarded.run({ headers: {} }, () => createFetchWrapper(unforwarded)(URL_, init));

        expect(fetchMock).toHaveBeenCalledWith(URL_, init);
    });

    it('skips a forwarded entry without a value, and never sends one not marked forward', async () => {
        await inContext(() => createFetchWrapper(context)(URL_));

        const { headers } = sentRequest();
        expect(headers.has('x-trace-id')).toBe(false);
        expect([...headers.values()]).not.toContain('u-1');
    });

    it('replaces caller-provided forwarded headers with the context values', async () => {
        await inContext(() =>
            createFetchWrapper(context)(URL_, {
                headers: { 'x-tenant-id': 'caller-tenant', 'x-request-id': 'caller-req' },
            }),
        );

        expect(sentRequest().headers.get('x-tenant-id')).toBe('ctx-tenant');
        expect(sentRequest().headers.get('x-request-id')).toBe('ctx-req');
    });

    it('never changes the headers the caller passed in', async () => {
        const headers = new Headers({ 'x-custom': 'value' });

        await inContext(() => createFetchWrapper(context)(URL_, { headers }));

        expect([...headers.keys()]).toEqual(['x-custom']);
    });

    it('keeps a Request input’s method and body', async () => {
        await inContext(() =>
            createFetchWrapper(context)(new Request(URL_, { method: 'POST', body: 'payload' })),
        );

        const request = sentRequest();
        expect(request.method).toBe('POST');
        expect(await request.text()).toBe('payload');
        expect(request.headers.get('x-tenant-id')).toBe('ctx-tenant');
    });

    it('lets init.headers win over a Request input’s headers, like fetch itself', async () => {
        await inContext(() =>
            createFetchWrapper(context)(new Request(URL_, { headers: { 'x-from': 'request' } }), {
                headers: { 'x-from': 'init' },
            }),
        );

        expect(sentRequest().headers.get('x-from')).toBe('init');
    });

    describe.each<{ name: string; options: FetchWrapperOptions; tenant: string | null }>([
        { name: 'to an internal destination, the default', options: {}, tenant: 'ctx-tenant' },
        { name: 'to an external destination', options: { destination: 'external' }, tenant: null },
    ])('$name', ({ options, tenant }) => {
        const sources: [string, () => [string | URL | Request, RequestInit?]][] = [
            ['no init', () => [URL_]],
            ['an init.headers object', () => [URL_, { headers: { authorization: 'Bearer t' } }]],
            [
                'an init.headers Headers',
                () => [URL_, { headers: new Headers({ authorization: 'Bearer t' }) }],
            ],
            ['init.headers tuples', () => [URL_, { headers: [['authorization', 'Bearer t']] }]],
            ['a Request', () => [new Request(URL_, { headers: { authorization: 'Bearer t' } })]],
            [
                'a Request with an empty init',
                () => [new Request(URL_, { headers: { authorization: 'Bearer t' } }), {}],
            ],
            [
                'a URL with init.headers',
                () => [new URL(URL_), { headers: { authorization: 'Bearer t' } }],
            ],
        ];

        it.each(sources)(
            'sends the entries forwarded there and keeps the caller’s headers, given %s',
            async (source, args) => {
                await inContext(() => createFetchWrapper(context, options)(...args()));

                const { headers } = sentRequest();
                expect(headers.get('x-tenant-id')).toBe(tenant);
                expect(headers.get('x-request-id')).toBe('ctx-req');
                expect(headers.get('authorization')).toBe(source === 'no init' ? null : 'Bearer t');
            },
        );
    });

    const callerTenantSources: [string, () => [string | URL | Request, RequestInit?]][] = [
        ['an init.headers object', () => [URL_, { headers: { 'x-tenant-id': 'caller-tenant' } }]],
        ['a Request', () => [new Request(URL_, { headers: { 'x-tenant-id': 'caller-tenant' } })]],
    ];

    it.each(callerTenantSources)(
        'leaves a caller’s own header alone when its entry is not forwarded there, given %s',
        async (_source, args) => {
            await inContext(() =>
                createFetchWrapper(context, { destination: 'external' })(...args()),
            );

            expect(sentRequest().headers.get('x-tenant-id')).toBe('caller-tenant');
        },
    );
});
