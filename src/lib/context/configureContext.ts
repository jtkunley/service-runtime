import { AsyncLocalStorage } from 'async_hooks';

/** The request as an entry's `value` function sees it. */
export interface ContextRequest {
    /** Lower-cased names; a header sent more than once has its values joined with `, `. */
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly method?: string;
    readonly path?: string;
}

/** Where `run()` takes its values from: an HTTP request, a queue message, or a job. */
export interface ContextSource {
    headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    method?: string;
    path?: string;
}

export interface ContextEntry {
    /** Works out the entry's value at the start of each request. */
    value: (request: ContextRequest) => string | undefined;
    /** Without a value the request is rejected, and `run()` throws. */
    required?: boolean;
    /** Without it the value never leaves the service. */
    forward?: { header: string; to: 'internal' | 'all' };
}

export type ContextConfig = Readonly<Record<string, ContextEntry>>;

/** Rejects attributes `ContextEntry` doesn't have, which inference would otherwise let through silently. */
type NoUnknownAttributes<C> = {
    [K in keyof C]: { [A in Exclude<keyof C[K], keyof ContextEntry>]: never };
};

export type ContextValues<C extends ContextConfig> = {
    readonly [K in keyof C]: C[K] extends { required: true } ? string : string | undefined;
};

export interface Context<C extends ContextConfig> {
    /** @throws Error naming every required entry without a value, before `fn` runs. */
    run<T>(source: ContextSource, fn: () => T): T;
    /** @throws Error outside a context. */
    get<K extends keyof C & string>(name: K): ContextValues<C>[K];
    getStore(): ContextValues<C> | undefined;
}

type Values = Readonly<Record<string, string | undefined>>;

interface Resolution {
    values: Values;
    missing: string[];
}

interface ContextInternals {
    readonly config: ContextConfig;
    readonly resolve: (request: ContextRequest) => Resolution;
    readonly enter: <T>(values: Values, fn: () => T) => T;
}

const internals = new WeakMap<object, ContextInternals>();

/** A blank value counts as absent, so a header sent empty is treated as not sent. */
function normalize(value: string | undefined): string | undefined {
    return value?.trim() || undefined;
}

export function toContextRequest({ headers, method, path }: ContextSource): ContextRequest {
    const normalized: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(headers)) {
        normalized[name.toLowerCase()] = typeof value === 'object' ? value.join(', ') : value;
    }
    return { headers: normalized, method, path };
}

export function missingValuesMessage(missing: readonly string[]): string {
    const noun = missing.length === 1 ? 'value' : 'values';
    return `Missing required context ${noun}: ${missing.join(', ')}`;
}

/**
 * Declares the values every request carries. Each is worked out once, when the
 * request starts, and is then fixed for the rest of it.
 */
export function configureContext<const C extends ContextConfig>(
    config: C & NoUnknownAttributes<C>,
): Context<C> {
    const storage = new AsyncLocalStorage<Values>();
    const entries = Object.entries(config);

    const resolve = (request: ContextRequest): Resolution => {
        const values = Object.freeze(
            Object.fromEntries(
                entries.map(([name, entry]) => [name, normalize(entry.value(request))]),
            ),
        );
        const missing = entries
            .filter(([name, entry]) => entry.required && values[name] === undefined)
            .map(([name]) => name);
        return { values, missing };
    };

    const current = (): Values => {
        const values = storage.getStore();
        if (!values) throw new Error('No request context');
        return values;
    };

    const context: Context<C> = {
        run(source, fn) {
            const { values, missing } = resolve(toContextRequest(source));
            // Fail loud at the boundary: work that runs without a required value,
            // such as the tenant, would read or write data under the wrong scope.
            if (missing.length > 0) throw new Error(missingValuesMessage(missing));
            return storage.run(values, fn);
        },
        get: (name) => current()[name] as ContextValues<C>[typeof name],
        getStore: () => storage.getStore() as ContextValues<C> | undefined,
    };
    internals.set(context, {
        config,
        resolve,
        enter: (values, fn) => storage.run(values, fn),
    });
    return context;
}

export function contextInternals(context: object): ContextInternals {
    const found = internals.get(context);
    if (!found) throw new TypeError('Expected a context created by configureContext');
    return found;
}
