import type { Context, ContextConfig } from './configureContext';

/** Each destination the service calls, with the names of the entries it receives. */
export type Destinations = Readonly<Record<string, readonly string[]>>;

/**
 * Checks each listed name against the context's entries. Whether the entry has
 * a `header` is checked at startup instead: with inline `value` functions,
 * TypeScript compares the lists before it has inferred the entries' attributes.
 */
export type ValidDestinations<C extends ContextConfig, D> = {
    readonly [K in keyof D]: readonly (keyof C & string)[];
};

export type GetHeaders<D> = (destination: keyof D & string) => Readonly<Record<string, string>>;

/** @throws TypeError, at startup, for a destination listing an entry that is unknown or has no `header`. */
export function createGetHeaders<C extends ContextConfig, D extends Destinations>(
    context: Pick<Context<C>, 'getStore'>,
    config: C,
    destinations: D & ValidDestinations<C, D>,
): GetHeaders<D> {
    const sent = new Map(
        Object.entries(destinations).map(([destination, names]) => [
            destination,
            names.map((name) => {
                const header = config[name]?.header;
                if (header === undefined) {
                    throw new TypeError(
                        `Destination "${destination}" lists "${name}", which is not an entry with a header`,
                    );
                }
                return { name, header };
            }),
        ]),
    );

    return (destination) => {
        const entries = sent.get(destination);
        if (!entries) {
            throw new Error(`Unknown destination: ${destination}`);
        }
        const values = context.getStore() as
            Readonly<Record<string, string | undefined>> | undefined;
        const headers: Record<string, string> = {};
        for (const { name, header } of entries) {
            const value = values?.[name];
            if (value !== undefined) headers[header] = value;
        }
        return headers;
    };
}
