/** The request data handed to context resolvers. */
export interface ContextRequest {
  /** Incoming headers keyed by lower-cased name; repeated headers are joined with `", "`. */
  readonly headers: Readonly<Partial<Record<string, string>>>;
  readonly method?: string | undefined;
  /** The request path without its query string. */
  readonly path?: string | undefined;
}

/** Declares how one context value is resolved and, optionally, forwarded. */
export interface ContextEntry {
  /** Resolves the value synchronously; blank strings count as absent. */
  value(request: ContextRequest): string | undefined;
  /** When true, scoped work is rejected unless the value is present. */
  readonly required?: boolean | undefined;
  /** The outbound header name used when a destination lists this entry. */
  readonly header?: string | undefined;
}

/** Context entries keyed by name. */
export type ContextEntries = Readonly<Record<string, ContextEntry>>;

/** Rejects entry attributes that {@link ContextEntry} does not declare. */
export type KnownAttributes<Entries> = {
  readonly [Name in keyof Entries]: Readonly<
    Record<Exclude<keyof Entries[Name], keyof ContextEntry>, never>
  >;
};

/**
 * Maps each destination name to the context entries it may receive. A destination named
 * `default` is used when `getHeaders()` is called without a name.
 */
export type ContextDestinations = Readonly<Record<string, readonly string[]>>;

/** Rejects destination lists that name entries not declared in the context. */
export type KnownEntries<Entries, Destinations> = {
  readonly [Name in keyof Destinations]: readonly (keyof Entries & string)[];
};

/** The declared destination names; `never` when no specific destinations were declared. */
export type DestinationNames<Destinations> = string extends keyof Destinations
  ? never
  : keyof Destinations & string;

/** The `getHeaders` parameters: the name may be omitted only when a `default` destination exists. */
export type GetHeadersArgs<Destination extends string> = "default" extends Destination
  ? [destination?: Destination]
  : [destination: Destination];

/** The resolved values: required entries are strings, the rest may be `undefined`. */
export type ContextValues<Entries> = {
  readonly [Name in keyof Entries as string extends Name ? never : Name]: Entries[Name] extends {
    readonly required: true;
  }
    ? string
    : string | undefined;
};

/** The input used to establish a context outside of HTTP handling. */
export interface ContextSource {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly method?: string | undefined;
  readonly path?: string | undefined;
}

/** Scoped access to the values resolved for the current execution. */
export interface ServiceContext<Values, Destination extends string> {
  /** Resolves a context from `source` and runs `fn` inside it, returning whatever `fn` returns. */
  run<Result>(source: ContextSource, fn: () => Result): Result;
  /** Returns one current value; throws `No request context` outside a context. */
  get<Name extends keyof Values>(name: Name): Values[Name];
  /** Returns all current values, or `undefined` outside a context. */
  getStore(): Values | undefined;
  /**
   * Returns the defined values a destination may receive, keyed by their outbound header names.
   * Without a name, uses the destination named `default`.
   */
  getHeaders(...destination: GetHeadersArgs<Destination>): Record<string, string>;
}

/** The untyped store used internally; public types narrow it per configuration. */
export type ContextStore = Readonly<Record<string, string | undefined>>;
