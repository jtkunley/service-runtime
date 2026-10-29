# @jtkunley/service-runtime

[![CI](https://github.com/jtkunley/service-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/jtkunley/service-runtime/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

The runtime plumbing every Node.js HTTP service ends up writing, done once and done carefully, behind one call:

- **Request context**: the values each request carries, such as its tenant and request ID, available anywhere through `AsyncLocalStorage` and sent on to the services it calls.
- **Health probes**: readiness and liveness, answered before your app sees the request.
- **Graceful shutdown** that really drains: readiness fails first, open requests finish, cleanups run in order, all within a deadline.
- **Fatal error handling**: an uncaught exception or unhandled rejection is logged, and the process exits.

No runtime dependencies, and it works with any logger.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Design decisions](#design-decisions)
- [Request context](#request-context)
  - [Declaring the values](#declaring-the-values)
  - [Reading values](#reading-values)
  - [Logging the values](#logging-the-values)
  - [Background jobs and message consumers](#background-jobs-and-message-consumers)
  - [Sending values on](#sending-values-on)
- [Starting and stopping](#starting-and-stopping)
  - [Health probes](#health-probes)
  - [Graceful shutdown](#graceful-shutdown)
  - [Fatal errors](#fatal-errors)
- [API](#api)
- [Development](#development)
- [License](#license)

## Install

```bash
npm i @jtkunley/service-runtime
```

Requires Node.js 22 or later.

## Quick start

```ts
import express from 'express';
import { configureService } from '@jtkunley/service-runtime';
import { rootLogger } from './logger'; // your logger, see the logger option

const service = configureService({ logger: rootLogger, port: 3000 });

const app = express();
app.get('/hello', (_req, res) => res.json({ hello: 'world' }));

await service.listen(app);
```

That's a production-ready server: probes on `/readiness` and `/liveness`, graceful shutdown on SIGTERM and SIGINT, and an exit on any uncaught error. Add [request context](#request-context) when requests carry values such as a tenant or a request ID, and [cleanups](#starting-and-stopping) when the service opens resources. Express is only an example: `listen` takes any Node request listener.

## Design decisions

- **One way to wire a service.** Readiness has to read the state graceful shutdown marks, probes have to be answered before the context middleware can reject them, and the signal and fatal handlers belong to the one server the process runs. `configureService` gets that right every time, and the parts it's built from aren't exported, so they can't be wired any other way.
- **The package carries values; your service decides what they mean.** Tenancy, request IDs and anything else are the service's own declarations, each with a function that works out its value and attributes for whether it's required and which header it travels under. A request missing a required value is answered `400` before it reaches your code, and the values are frozen for the rest of the request, so nothing can switch tenants partway through.
- **Each destination lists what it receives.** One line shows exactly which values a third party gets. The package makes the headers and leaves sending them to whichever HTTP client or message producer the service uses.
- **Probes never need context.** Readiness and liveness are answered before the app sees the request, so a probe without a tenant header can't be rejected and leave a pod never ready.
- **Shutdown drains, it doesn't just stop.** Readiness fails first, so the load balancer stops routing here, then the server stops accepting connections. `server.close()` alone leaves a keep-alive connection open if it was busy when shutdown began, so idle connections are swept every second until the last response is out. A second signal can't cut cleanup short, and liveness keeps passing, so the orchestrator doesn't kill a process that is draining.
- **After a fatal error, exit.** An uncaught exception leaves the process in an unknown state, so it is logged and the process exits `1` without attempting a graceful shutdown, leaving the restart to the orchestrator.
- **Importing the service is safe in tests.** `configureService` touches nothing process-wide. The signal and fatal handlers are registered by `listen`, which tests don't call, so a stray rejection in a test is reported by the test runner instead of exiting it.
- **The last log line gets out.** Every exit, clean, forced or fatal, first waits up to a second for a logger that can `flush()`, so the line explaining the exit isn't lost in a buffer.
- **Only what every service needs.** No runtime dependencies, no framework beyond a thin Express-compatible middleware, and the `exports` map keeps internals private.
- **Tested the way it runs.** Unit tests hold coverage at 100%, enforced in CI. Component tests build the package as published, install it beside a real Express service, and drive that service as a separate process with real requests, real signals and real exit codes.

## Request context

A service declares, once at startup, the values every request carries. Each entry has a `value` function that works the value out when a request starts, and attributes that decide what happens to it. The values are held in [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html) for the rest of the request, so any code can read them without passing them through every call.

### Declaring the values

```ts
import { randomUUID } from 'node:crypto';

export const service = configureService({
  logger: rootLogger,
  port: 3000,
  context: {
    // Multi-tenancy: which tenant a request acts for, so every service scopes its data to it.
    tenantId: {
      value: (req) => req.headers['x-tenant-id'],
      required: true,
      header: 'x-tenant-id',
    },
    // Request threading: one ID across every service a request touches, so its logs join up.
    requestId: {
      value: (req) => req.headers['x-request-id']?.trim() || randomUUID(),
      header: 'x-request-id',
    },
  },
  // Each service or API this one calls, and the values it receives.
  destinations: {
    platform: ['tenantId', 'requestId'],
    payments: ['requestId'], // a third party never learns which tenant is calling
  },
});
```

Export the service from one module, so the whole app shares its context.

| Attribute | Description |
|-----------|-------------|
| `value` | `(req) => string \| undefined`, called once at the start of each request with its headers (lower-cased names), method and path (without the query string). The result is trimmed, and a blank one counts as absent. |
| `required` | Without a value, the middleware answers `400` and `run()` throws. |
| `header` | The header the value travels under, to the destinations that list it. Without it, the value never leaves the service. |

Any other attribute is a compile error, so a misspelling like `requried` can't be silently ignored. A destination listing an entry that doesn't exist is a compile error too, and one listing an entry without a `header` fails at startup.

A single-tenant service names its one tenant instead of reading a header, `value: () => process.env.TENANT_ID`, so no caller can route a request to another tenant.

A header is only as trustworthy as whatever sets it. Read the tenant from a header only behind a gateway that sets it, or strips it from outside traffic.

### Reading values

```ts
app.use(service.middleware);

service.context.get('tenantId');  // string: a required entry always has a value
service.context.get('requestId'); // string | undefined
service.context.getStore();       // { tenantId, requestId }, frozen, or undefined outside a request
```

`service.middleware` works out every value at the start of each request and calls `next()` inside the context. A request missing a required value is answered `400` with `{ error: 'Missing required context value: tenantId' }` and never reaches `next()`. It's logged as an error with the method, the path without its query string, which can carry secrets, and the names of the missing entries.

`get` accepts only declared names, and its return type follows the entry's `required` attribute.

### Logging the values

Adding the values to every log line is the logger's job: have it read `service.context.getStore()` for each line it writes. With pino, that's a mixin:

```ts
const logger = pino({ mixin: () => service.context.getStore() ?? {} });
```

Every line logged inside a request then carries its values. The package's own lines add only what the logger can't know: a rejected request's method, path and missing entries, or a shutdown's signal.

### Background jobs and message consumers

```ts
await service.context.run({ headers: { 'x-tenant-id': tenantId } }, () => runJob());
await service.context.run({ headers: message.headers }, () => handle(message));
```

`run()` uses the same `value` functions as the middleware, so every value has one source of truth. It throws, naming every required entry without a value, before calling the function.

### Sending values on

`getHeaders(destination)` returns the headers for a call to a declared destination: each value it lists, under its entry's `header`. Unset values are left out, and outside a request it returns `{}`. Only declared destinations are accepted, so a typo is a compile error.

```ts
service.context.getHeaders('platform'); // { 'x-tenant-id': 'tenant-1', 'x-request-id': 'req-1' }
service.context.getHeaders('payments'); // { 'x-request-id': 'req-1' }
```

Wire them into whatever sends the request once, so no call can leave without them. For `fetch`, that's a wrapper the app calls instead, sending to its usual destination unless told otherwise. The values are set last, replacing any header of the same name the caller set:

```ts
type Destination = Parameters<typeof service.context.getHeaders>[0];

export function serviceFetch(url: string | URL, init: RequestInit = {}, destination: Destination = 'platform') {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(service.context.getHeaders(destination))) {
    headers.set(name, value);
  }
  return fetch(url, { ...init, headers });
}

await serviceFetch('https://orders.internal/orders');
await serviceFetch('https://api.payments.example/charges', { method: 'POST', body }, 'payments');
```

Other clients take them the same way:

```ts
// axios, for every request the instance makes
platformApi.interceptors.request.use((config) => {
  Object.assign(config.headers, service.context.getHeaders('platform'));
  return config;
});

// a queue producer: the consumer's context.run({ headers: message.headers }) reads them back
await queue.publish(payload, { headers: service.context.getHeaders('platform') });
```

## Starting and stopping

```ts
const service = configureService({
  logger: rootLogger,
  port: 3000,
  cleanups: [() => queueConsumer.close(), () => db.end()],
  // Behind a load balancer: keep serving until it has stopped routing here.
  onShutdownStart: () => new Promise((resolve) => setTimeout(resolve, 10_000)),
});

const { port } = await service.listen(app);
```

Everything about the service is configured in one place; `listen` takes only the app, an Express app or any Node request listener. It starts the server with the probes and graceful shutdown, and resolves with the bound address once the server is listening.

`cleanups` run in order once the server has closed, sync or async. List what produces work first, such as a message queue consumer, then the clients it uses, such as Redis or the database. Each is called only at shutdown, so it can close a resource opened after the service is configured.

### Health probes

| Path | Answers |
|------|---------|
| `/readiness` | `200`, then `503` once shutdown starts, so the load balancer stops routing here. |
| `/liveness` | `200`, including during shutdown, so the orchestrator doesn't restart a process that is draining. |

Both answer `GET` and `HEAD` before the app sees the request, so they never need context values. Change a path, or turn a probe off, with `probes: { readiness: '/ready', liveness: false }`.

### Graceful shutdown

On the first shutdown signal, SIGTERM or SIGINT unless `shutdownSignals` names others, the service:

1. Starts failing readiness
2. Runs `onShutdownStart`, if given, and waits for it
3. Stops accepting connections and waits for open requests to finish, closing keep-alive connections as they go idle
4. Runs the cleanups one after another, in order
5. Exits with code 0, or 1 if any step failed

The whole shutdown never takes longer than `forceExitMs`, 30 seconds by default; at the deadline the process exits with code 1. A step that fails is logged and the next one still runs. A repeated signal is logged and ignored, so it can't end the process in the middle of cleanup. Every shutdown line carries `{ signal }`, and a failed cleanup's line also carries `cleanup`: its function name, or its position such as `#2`.

Before any exit, a logger with `flush()` gets up to a second to write out what it has buffered, so the last lines, the timeout included, aren't lost.

### Fatal errors

From the moment `listen` is called, an `uncaughtException` or `unhandledRejection` is logged and the process exits with code 1 once the logger has flushed. The process is in an unknown state after either, so it skips graceful shutdown and leaves the restart to the orchestrator. Anything thrown that isn't an `Error` is wrapped in one and kept as its `cause`. A failure before `listen`, while the service is starting, takes Node's default: the stack trace on stderr and exit code 1.

## API

### `configureService(options)`

Returns a `Service`, touching nothing process-wide. Throws a `RangeError` for a `keepAliveTimeoutMs` or `forceExitMs` that isn't a positive integer, and for `shutdownSignals` that are empty or include one the process can't catch, such as `SIGKILL`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logger` | `RootLogger` | required | What the package's own lines go through: anything with `child(module, action)` returning `info(message, data)` and `error(message, error, data)`, and optionally `flush()`, awaited for up to a second before the process exits. Its children are `server` / `context`, `server` / `shutdown` and `server` / `fatal`. |
| `port` | `number` | required | The port to listen on; `0` picks a free one. |
| `host` | `string` | all interfaces | The address to listen on. |
| `probes` | `{ readiness?, liveness? }` | `/readiness`, `/liveness` | Each a path, or `false` to turn it off. |
| `context` | `ContextConfig` | none | The values every request carries, by name. See [Declaring the values](#declaring-the-values). |
| `destinations` | `Record<string, entry names[]>` | none | Each destination the service calls, and the entries whose headers it receives. |
| `cleanups` | `CleanupFn[]` | none | `() => void \| Promise<void>`, run in order on shutdown, once the server has closed. |
| `onShutdownStart` | `() => void \| Promise<void>` | none | Runs once, with readiness already failing and before the server closes, which waits for a returned promise. |
| `keepAliveTimeoutMs` | `number` | `65000` | How long an idle keep-alive connection stays open. Keep it above the load balancer's idle timeout (60 seconds for AWS ALB and nginx), or it may send a request on a connection Node is closing and get a 502. The headers timeout is set a second above it. |
| `shutdownSignals` | `NodeJS.Signals[]` | `['SIGTERM', 'SIGINT']` | The signals that start graceful shutdown: SIGTERM is what orchestrators send, SIGINT is Ctrl+C. |
| `forceExitMs` | `number` | `30000` | The most shutdown may take, from the first signal to the exit; then the process exits with code 1, after up to a second for the logger to flush. |

Every option set, each to something other than its default:

```ts
const service = configureService({
  logger: rootLogger,
  port: 8080,
  host: '0.0.0.0',
  probes: { readiness: '/ready', liveness: false },
  context: {
    tenantId: { value: (req) => req.headers['x-tenant-id'], required: true, header: 'x-tenant-id' },
    requestId: { value: (req) => req.headers['x-request-id']?.trim() || randomUUID(), header: 'x-request-id' },
    locale: { value: (req) => req.headers['accept-language'] }, // never leaves the service
  },
  destinations: {
    platform: ['tenantId', 'requestId'],
    payments: ['requestId'],
  },
  cleanups: [() => queueConsumer.close(), () => db.end()],
  onShutdownStart: () => new Promise((resolve) => setTimeout(resolve, 10_000)),
  keepAliveTimeoutMs: 75_000,
  shutdownSignals: ['SIGTERM'],
  forceExitMs: 45_000,
});
```

### `Service`

| Member | Description |
|--------|-------------|
| `middleware` | Express-compatible middleware that fills the context, answering `400` to a request missing a required value. |
| `context.get(name)` | The value of one entry. Throws `Error('No request context')` outside a request. |
| `context.getStore()` | Every value, frozen, or `undefined` outside a request. |
| `context.run(source, fn)` | Works out the values from `source`, `{ headers, method?, path? }`, and runs `fn` inside the context, returning what it returns. Throws if a required value is missing. |
| `context.getHeaders(destination)` | The headers for a call to a declared destination; `{}` outside a request. Throws for an undeclared one. |
| `isShuttingDown()` | Whether shutdown has started. |
| `listen(app)` | Registers the signal and fatal handlers and starts the server; resolves with its `AddressInfo`. One service per process listens; a second call rejects. |

### Types

`ServiceOptions`, `Service`, `ContextMiddleware` and `CleanupFn` describe the API above. `ContextEntry`, `ContextConfig`, `Destinations`, `ContextRequest` (what a `value` function receives), `ContextSource` (what `run()` takes) and `ContextValues<C>` (the values of a configuration) are exported for annotating your own code, as are the logger interfaces `RootLogger`, `ChildLogger` and `LogData`.

The package root and its `package.json` are the whole public surface: the `exports` map rejects deep imports.

## Development

Requires Node.js 22.18 or later, which runs the TypeScript component fixture directly.

```bash
npm install
npm run check           # typecheck, lint, formatting and all tests
npm run test:unit       # unit tests, next to the source in src/
npm run test:component  # component tests in test/component/
npm run test:coverage   # all tests, failing below 100% coverage
npm run format          # format with Prettier
npm run build           # compile the publishable package into dist/
```

```
src/
  index.ts                 the package root
  lib/service/             configureService, which wires everything below together
  lib/context/             the request context itself, and the headers for each destination
  lib/middleware/          the middleware that fills the context
  lib/shutdown/            graceful shutdown and the shutdown state
  lib/fatal/               fatal error handlers
  lib/shared/              logger types, error helpers, flushing the logger before exit
  **/__tests__/            unit tests, one spec per source file, named after it
test/component/            component tests against the built package
```

The component tests build the package as it is published, install it beside a small Express service in [`test/component/fixtures/`](test/component/fixtures/), and run that service as a separate process.

### Publishing

`npm run build` compiles into `dist/src/` and copies `package.json`, this README, the changelog and the license into `dist/`, which is the directory to publish:

```bash
npm run build && npm publish dist
```

Publishing from the repository root is refused, since it would ship the TypeScript sources.

## License

[MIT](LICENSE)
