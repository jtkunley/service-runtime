import { contextInternals, type Context, type ContextConfig } from './configureContext';

export interface FetchWrapperOptions {
    /** `'external'` forwards only entries marked `to: 'all'`, for third-party APIs. Default `'internal'`. */
    destination?: 'internal' | 'external';
}

export function createFetchWrapper<C extends ContextConfig>(
    context: Context<C>,
    { destination = 'internal' }: FetchWrapperOptions = {},
): typeof fetch {
    const forwarded = Object.entries(contextInternals(context).config).flatMap(
        ([name, { forward }]) =>
            forward && (destination === 'internal' || forward.to === 'all')
                ? [{ name, header: forward.header }]
                : [],
    );

    return (input, init) => {
        const values = context.getStore() as
            Readonly<Record<string, string | undefined>> | undefined;
        if (!values || forwarded.length === 0) {
            return globalThis.fetch(input, init);
        }

        const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined),
        );
        for (const { name, header } of forwarded) {
            const value = values[name];
            if (value !== undefined) headers.set(header, value);
        }

        return globalThis.fetch(input, { ...init, headers });
    };
}
