import type { RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  ContextDestinations,
  ContextEntries,
  KnownAttributes,
  KnownEntries,
  ServiceContext,
} from "../context/types.js";
import type { Middleware } from "../http/middleware.js";
import type { Logger } from "../logging/logger.js";

// eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- an empty context has no keys
export type EmptyRecord = Record<never, never>;

/** Releases an application resource during shutdown; may return a promise. */
export type Cleanup = () => unknown;

/** Runs when graceful shutdown starts, before the server stops accepting connections. */
export type ShutdownHook = () => unknown;

export interface ProbeOptions {
  /** Readiness path, or `false` to disable. Defaults to `/readiness`. */
  readonly readiness?: string | false | undefined;
  /** Liveness path, or `false` to disable. Defaults to `/liveness`. */
  readonly liveness?: string | false | undefined;
}

export interface ServiceOptions<
  Entries extends ContextEntries = EmptyRecord,
  Destinations extends ContextDestinations = EmptyRecord,
> {
  readonly logger: Logger;
  /** An integer from 0 through 65535; `0` selects an available port. */
  readonly port: number;
  /** Interface to bind; Node's default binding is used when omitted. */
  readonly host?: string | undefined;
  readonly context?: (Entries & NoInfer<KnownAttributes<Entries>>) | undefined;
  readonly destinations?: (Destinations & NoInfer<KnownEntries<Entries, Destinations>>) | undefined;
  readonly probes?: ProbeOptions | undefined;
  /** Run sequentially, in order, after the server closes. */
  readonly cleanups?: readonly Cleanup[] | undefined;
  /** Defaults to 65,000 ms. The headers timeout is set 1,000 ms higher. */
  readonly keepAliveTimeoutMs?: number | undefined;
  /** Defaults to `SIGTERM` and `SIGINT`. */
  readonly shutdownSignals?: readonly NodeJS.Signals[] | undefined;
  /** Graceful shutdown deadline. Defaults to 30,000 ms. */
  readonly forceExitMs?: number | undefined;
  readonly onShutdownStart?: ShutdownHook | undefined;
}

export interface Service<Values = EmptyRecord, Destination extends string = "default"> {
  readonly context: ServiceContext<Values, Destination>;
  /** Express-compatible middleware that runs downstream work inside a resolved context. */
  readonly middleware: Middleware;
  /** Becomes `true` once graceful shutdown or fatal exit begins, and never resets. */
  isShuttingDown(): boolean;
  /** Starts the HTTP server and process handlers; resolves with the bound address. */
  listen(app: RequestListener): Promise<AddressInfo>;
}
