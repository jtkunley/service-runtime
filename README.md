# @jtkunley/service-runtime

[![CI](https://github.com/jtkunley/service-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/jtkunley/service-runtime/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

The runtime plumbing every Node.js HTTP service ends up writing, done once and done carefully, behind one call: **request context** that carries the values each request needs, such as its tenant and request ID, through `AsyncLocalStorage`, **health probes**, **graceful shutdown** that really drains, **fatal error handling**, and **deployment tier** checks. It has no runtime dependencies.

## Contents

- [Design decisions](#design-decisions)
- [Install](#install)
- [Quick start](#quick-start)
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
- [Deployment tier](#deployment-tier)
- [API](#api)
- [Related packages](#related-packages)
- [Development](#development)
- [License](#license)

## Design decisions

- **One way to wire a service.** The fatal handlers have to be registered before anything can fail, readiness has to read the same state graceful shutdown marks, and probes have to be answered before the context middleware rejects them. `configureService` and `listen` get that right every time, and the parts they're built from aren't exported, so they can't be wired any other way.
- **The package carries values; your service decides what they mean.** Tenancy, request IDs and anything else are declared by the service, each with a function that works out its value and attributes for whether it's required and which header it travels under. A request missing a required value is answered `400` before it reaches your code, and the values are frozen for the rest of the request, so nothing can switch tenants partway through. Each destination the service calls lists the values it receives, so one line shows what a third party gets, and the package makes the headers without caring which HTTP client sends them.
- **Probes never need context.** Readiness and liveness are answered before the app sees the request, so a probe without a tenant header can't be rejected and leave a pod never ready.
- **Shutdown drains, it doesn't just stop.** Readiness fails first, so the load balancer stops routing here, then the server stops accepting connections. `server.close()` alone leaves a keep-alive connection open if it was busy when shutdown began, so idle connections are swept every second until the last response is out. Cleanups then run in order, each failure named in the log, all within a hard deadline. A second signal can't cut cleanup short, and liveness keeps passing, so the orchestrator doesn't kill a process that is draining.
- **After a fatal error, exit.** An uncaught exception leaves the process in an unknown state, so the process logs it and exits `1` without attempting a graceful shutdown, and leaves the restart to the orchestrator.
- **The last log line gets out.** Every exit, clean, forced or fatal, first waits for a logger that can `flush()`, for at most a second, so the line explaining the exit isn't lost in a buffer.
- **Unknown tiers unlock nothing.** A tier on neither list, unset included, passes neither `isProdTier` nor `isNonProdTier`, so a misconfigured deployment can't switch on mocks or paging.
- **Only what every service needs, and nothing it doesn't.** No runtime dependencies, no framework beyond a thin Express adapter, and the `exports` map keeps internals private. Scheduled jobs, which not every service has, live in [`@jtkunley/cron`](https://github.com/jtkunley/cron).
- **Tested the way it runs.** Unit tests hold coverage at 100%, enforced in CI. Component tests build the package as published, install it beside a real Express service, and drive that service as a separate process with real requests, real signals and real exit codes.

## Install

```bash
npm i @jtkunley/service-runtime
```

Requires Node.js 22 or later. Bring your own logger: anything that implements the small `RootLogger` interface, `child(module, action)` returning `info`, `warn` and `error`, and optionally `flush()`, which is awaited before the process exits. A [`@jtkunley/logger`](https://github.com/jtkunley/logger) root logger fits as it is.

## Quick start

A service wired end to end. The component tests run a service much like this one, in [`test/component/fixtures/service.mts`](test/component/fixtures/service.mts).

```ts
// service.ts
import { randomUUID } from 'node:crypto';
import { configureService } from '@jtkunley/service-runtime';
import { rootLogger } from './logger'; // your RootLogger implementation

// First, before the app is built: it registers the fatal error handlers.
export const service = configureService({
  logger: rootLogger,
  context: {
    tenantId: {
      value: (req) => req.headers['x-tenant-id'],
      required: true,
      header: 'x-tenant-id',
    },
    requestId: {
      value: (req) => req.headers['x-request-id']?.trim() || randomUUID(),
      header: 'x-request-id',
    },
  },
  destinations: {
    platform: ['tenantId', 'requestId'],
  },
});
```

```ts
// main.ts
import express from 'express';
import { service } from './service';

const app = express();
app.use(service.middleware);
app.get('/orders', async (_req, res) => {
  const orders = await fetch(`https://orders.internal/tenants/${service.context.get('tenantId')}/orders`, {
    headers: service.context.getHeaders('platform'),
  });
  res.json(await orders.json());
});

service.onShutdown(closeDb);
await service.listen(app, { port: 3000 });
```

That's the whole integration: probes on `/readiness` and `/liveness`, the context filled for every request, graceful shutdown on SIGTERM and SIGINT, and an exit on any uncaught error.

## Request context

A service declares, once at startup, the values every request carries. Each entry has a `value` function that works it out when a request starts, and attributes that decide what happens to it. The values are held in [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html) for the rest of the request, so any code can read them without passing them through every call. The package knows nothing about what the values mean: tenancy, request IDs, locales and anything else are the service's own declarations.

### Declaring the values

```ts
configureService({
  logger: rootLogger,
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

| Attribute | Description |
|-----------|-------------|
| `value` | `(req) => string \| undefined`, called once at the start of each request with its headers (lower-cased names), method and path. The result is trimmed, and a blank one counts as absent. |
| `required` | Without a value, the middleware answers `400` and `run()` throws. |
| `header` | The header the value travels under, to the destinations that list it. Without it, the value never leaves the service. |

Any other attribute is a compile error, so a misspelling like `requried` can't be silently ignored. A destination listing an entry that doesn't exist is a compile error too, and one listing an entry without a `header` fails at startup.

A single-tenant service names its one tenant instead of reading the header, `value: () => process.env.TENANT_ID`, so no caller can route a request to another tenant.

A header is only as trustworthy as whatever sets it. Read the tenant from a header only behind a gateway that sets it, or strips it from outside traffic.

### Reading values

```ts
app.use(service.middleware);

service.context.get('tenantId');  // string: a required entry always has a value
service.context.get('requestId'); // string | undefined
service.context.getStore();       // { tenantId, requestId }, frozen, or undefined outside a request
```

`service.middleware` works out every value at the start of each request and calls `next()` inside the context. A request missing a required value is answered `400` with `{ error: 'Missing required context value: tenantId' }` and never reaches `next()`; it's logged as an `error` through the child logger `server` / `context`, with the method, full path and the names of the missing entries.

`get` accepts only configured names, and its return type follows the entry's `required` attribute.

### Logging the values

Adding the values to log lines is the logger's job, not this package's. With [`@jtkunley/logger`](https://github.com/jtkunley/logger), each value is a resolver run on every line, so everything logged inside a request carries them, including this package's own lines:

```ts
import { logger } from '@jtkunley/logger';

logger.configureContext({
  tenantId: () => service.context.getStore()?.tenantId,
  requestId: () => service.context.getStore()?.requestId,
});
```

The package's own log lines therefore carry only what the logger can't know: a rejected request's method, path and missing entries, or a shutdown's signal.

### Background jobs and message consumers

```ts
await service.context.run({ headers: { 'x-tenant-id': tenantId } }, () => runJob());
await service.context.run({ headers: message.headers }, () => handle(message));
```

`run()` uses the same `value` functions as the middleware, so every value has one source of truth. It throws, naming every required entry without a value, before calling the function.

### Sending values on

`getHeaders(destination)` returns the headers for a call to one of the declared destinations: each value it lists, under its entry's `header`. Values that are unset are left out, and outside a request it returns `{}`. Only declared destinations are accepted, so a typo is a compile error.

```ts
service.context.getHeaders('platform'); // { 'x-tenant-id': 'tenant-1', 'x-request-id': 'req-1' }
service.context.getHeaders('payments'); // { 'x-request-id': 'req-1' }
```

The service wires them into whatever sends the request, once. Spread them last, so they replace a header of the same name the caller set:

```ts
// fetch
await fetch(url, { ...init, headers: { ...init?.headers, ...service.context.getHeaders('platform') } });

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
service.onShutdown(() => queueConsumer.close());
service.onShutdown(() => db.end());

const { port } = await service.listen(app, {
  port: 3000,
  onShutdownStart: () => new Promise((resolve) => setTimeout(resolve, 10_000)),
});
```

`listen` takes the app, an Express app or any Node request listener, starts the server, and sets up the probes and graceful shutdown. It resolves with the bound address once the server is listening.

Register cleanups with `onShutdown` where the resource is opened; they run in the order registered, sync or async. Register what produces work first (e.g. a message queue consumer), then shared clients (e.g. Redis, the database).

### Health probes

| Path | Answers |
|------|---------|
| `/readiness` | `200`, then `503` once shutdown starts, so the load balancer stops routing here. |
| `/liveness` | `200`, including during shutdown, so the orchestrator doesn't restart a process that is draining. |

Both answer `GET` and `HEAD` before the app sees the request, so they never need context values. Change a path, or turn a probe off, with `probes: { readiness: '/ready', liveness: false }`.

### Graceful shutdown

On the first SIGTERM or SIGINT, the service:

1. Starts failing readiness
2. Runs `onShutdownStart`, if given, and waits for it (e.g. for the load balancer to stop routing to the pod)
3. Stops the server accepting connections and waits for open requests to finish, closing keep-alive connections as they go idle
4. Runs the cleanups one after another, in the order registered
5. Exits with code 0, or 1 if any step failed

The whole shutdown never takes longer than `forceExitMs` (30 seconds by default); at the deadline the process exits with code 1. A step that fails is logged and the next one still runs. A repeated signal is logged and ignored, so it can't end the process in the middle of cleanup. Shutdown logs use the child logger `server` / `shutdown`; every line carries `{ signal }`, and a failed cleanup's line also carries `cleanup`, its function name or its position such as `#2`.

Before any exit, a logger with `flush()` gets up to a second to write out what it has buffered, so the last lines, the timeout included, aren't lost.

### Fatal errors

From the moment `configureService` returns, an `uncaughtException` or `unhandledRejection` is logged through the child logger `server` / `fatal`, and the process exits with code 1 once the logger has flushed. The process is in an unknown state after either, so it skips graceful shutdown and leaves the restart to the orchestrator. Anything thrown that isn't an `Error` is wrapped in one and kept as its `cause`.

## Deployment tier

`TIER` names the deployment a process runs in. Gate what must never reach production (mock adapters, an interactive API console) on `isNonProdTier`, and what must only run in production (real integrations, paging) on `isProdTier`. A tier on neither list, unset included, passes neither check, so an unknown deployment unlocks nothing.

```ts
import { getTier, isNonProdTier } from '@jtkunley/service-runtime/tier';

if (isNonProdTier(getTier())) {
  app.use('/docs', apiConsole);
}
```

| Export | Answers |
|--------|---------|
| `getTier(env = process.env)` | `TIER` trimmed and lower-cased, or `undefined` when it is unset or blank. Only `env`'s own `TIER` is read, never an inherited one. |
| `isNonProdTier(tier)` | `true` for `local`, `dev`, `test`, `qa`, `staging` and `pr<digits>` (a pull request preview), after trimming and lower-casing. |
| `isProdTier(tier)` | `true` for `prod` and `production`, after trimming and lower-casing. |
| `NON_PROD_TIER_PATTERN`, `PROD_TIER_PATTERN` | The two lists' sources as strings, `^(?:local\|dev\|test\|qa\|staging\|pr\d+)$` and `^(?:prod\|production)$`, matched against the normalised tier. |
| `TierEnv` | The environment type `getTier` reads, `Readonly<Record<string, string \| undefined>>`. |

The tier checks are also exported from the root. `@jtkunley/service-runtime/tier` loads nothing else, for code that wants only them.

## API

### `configureService({ logger, context, destinations? })`

Registers the fatal error handlers and returns a `Service`. Call it once per process, first at startup; a second call throws an `Error`.

| `Service` member | Description |
|------------------|-------------|
| `middleware` | Express middleware that fills the context, answering `400` to a request missing a required value. |
| `context.get(name)` | The value of one entry. Throws `Error('No request context')` outside a request. |
| `context.getStore()` | Every value, frozen, or `undefined` outside a request. |
| `context.run(source, fn)` | Works out the values from `source`, `{ headers, method?, path? }`, and runs `fn` inside the context, returning what it returns. Throws if a required value is missing. |
| `context.getHeaders(destination)` | The headers for a call to a declared destination; `{}` outside a request. Throws for an undeclared one. |
| `onShutdown(cleanup)` | Adds a `CleanupFn`, `() => void \| Promise<void>`, to run on shutdown. |
| `isShuttingDown()` | Whether shutdown has started. |
| `listen(app, options)` | Starts the server; resolves with its `AddressInfo`. Call it once; a second call rejects. |

| `listen` option | Type | Default | Description |
|-----------------|------|---------|-------------|
| `port` | `number` | required | The port to listen on; `0` picks a free one. |
| `host` | `string` | all interfaces | The address to listen on. |
| `probes` | `{ readiness?, liveness? }` | `/readiness`, `/liveness` | Each a path, or `false` to turn it off. |
| `forceExitMs` | `number` | `30000` | The most shutdown may take, from the first signal to the exit; then the process exits with code 1, after up to a second for the logger to flush. A positive integer. |
| `onShutdownStart` | `() => void \| Promise<void>` | none | Runs once, with readiness already failing and before the server closes, which waits for a returned promise. |

### Types

`ServiceOptions`, `Service`, `ListenOptions` and `CleanupFn` describe the API above. `ContextEntry`, `ContextConfig`, `ContextRequest` (what a `value` function receives), `ContextSource` (what `run()` takes) and `ContextValues<C>` (the values of a configuration) are exported for annotating your own code, as are the logger interfaces `RootLogger`, `ChildLogger` and `LogData`.

### Entry points

| Import | Exports |
|--------|---------|
| `@jtkunley/service-runtime` | `configureService`, the tier checks, and the types above |
| `@jtkunley/service-runtime/tier` | `getTier`, `isNonProdTier`, `isProdTier`, `NON_PROD_TIER_PATTERN`, `PROD_TIER_PATTERN`, `TierEnv` |

These and `@jtkunley/service-runtime/package.json` are the whole public surface: the `exports` map rejects deep imports into `src/`.

## Related packages

- [`@jtkunley/logger`](https://github.com/jtkunley/logger): structured JSON logging on pino, whose root logger fits the `RootLogger` interface, `flush()` included, and whose context injection adds the request's values to every line.
- [`@jtkunley/cron`](https://github.com/jtkunley/cron): scheduled jobs that skip overlapping runs and stop cleanly. Run each tick in the request context with `runInContext: (tick) => service.context.run({ headers: { 'x-tenant-id': tenantId } }, tick)`, and stop it with `service.onShutdown(() => job.stop())`.

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
  index.ts                 the root entry point
  lib/service/             configureService, which wires everything below together
  lib/context/             the request context itself, and the headers for each destination
  lib/middleware/          Express middleware that fills the context
  lib/shutdown/            graceful shutdown and the shutdown state
  lib/fatal/               fatal error handlers
  lib/tier/                deployment tier checks, the /tier entry point
  lib/shared/              logger types, error helpers, flushing the logger before exit
  **/__tests__/            unit tests, one spec per source file
test/component/            component tests against the built package
```

Each source file has its unit spec beside it in `__tests__`, named after it. The component tests build the package as it is published, install it beside a small Express service in [`test/component/fixtures/`](test/component/fixtures/), and run that service as a separate process.

### Publishing

`main`, `types` and `exports` in package.json point at built output. `npm run build` compiles it into `dist/src/` and copies `package.json`, this README, the changelog and the license into `dist/`, which is the directory to publish:

```bash
npm run build && npm publish dist
```

Publishing from the repository root is refused, since it would ship the TypeScript sources.

## License

[MIT](LICENSE)
