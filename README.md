# @jtkunley/service-runtime

[![CI](https://github.com/jtkunley/service-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/jtkunley/service-runtime/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

The runtime plumbing every Node.js HTTP service ends up writing, done once and done carefully: **request context** that carries the values each request needs, such as its tenant and request ID, through `AsyncLocalStorage`, **graceful shutdown** that really drains, **fatal error handling**, and **deployment tier** checks. It has no runtime dependencies.

## Contents

- [Design decisions](#design-decisions)
- [Install](#install)
- [Quick start](#quick-start)
- [Request context](#request-context)
  - [Configuring the context](#configuring-the-context)
  - [Reading values](#reading-values)
  - [Express middleware](#express-middleware)
  - [Background jobs and message consumers](#background-jobs-and-message-consumers)
  - [Outgoing fetch](#outgoing-fetch)
  - [API](#request-context-api)
- [Entry points](#entry-points)
- [Deployment tier](#deployment-tier)
- [Graceful shutdown](#graceful-shutdown)
  - [Usage](#usage)
  - [Fatal errors](#fatal-errors)
  - [API](#graceful-shutdown-api)
- [Related packages](#related-packages)
- [Development](#development)
- [License](#license)

## Design decisions

- **The package carries values; your service decides what they mean.** Tenancy, request IDs and anything else are declared by the service, each with a function that works out its value and attributes for whether it's required and where it's forwarded. A request missing a required value is answered `400` before it reaches your code, and the values are frozen for the rest of the request, so nothing can switch tenants partway through. Third-party APIs only receive the values marked for every destination.
- **Shutdown drains, it doesn't just stop.** Readiness fails first, so the load balancer stops routing here, then the server stops accepting connections. `server.close()` alone leaves a keep-alive connection open if it was busy when shutdown began, so idle connections are swept every second until the last response is out. Cleanups then run in order, each failure named in the log, all within a hard deadline. A second signal can't cut cleanup short.
- **After a fatal error, exit.** An uncaught exception leaves the process in an unknown state, so the fatal handlers log and exit `1` without attempting a graceful shutdown, and leave the restart to the orchestrator.
- **Unknown tiers unlock nothing.** A tier on neither list, unset included, passes neither `isProdTier` nor `isNonProdTier`, so a misconfigured deployment can't switch on mocks or paging.
- **One registration per process.** Calling `setupGracefulShutdown` or `registerFatalHandlers` twice throws, instead of silently ignoring a second server or logging every failure twice.
- **Only what every service needs, and nothing it doesn't.** No runtime dependencies, no framework beyond a thin Express adapter, and the `exports` map keeps internals private. Scheduled jobs, which not every service has, live in [`@jtkunley/cron`](https://github.com/jtkunley/cron).
- **Tested the way it runs.** Unit tests hold coverage at 100%, enforced in CI. Component tests build the package as published, install it beside a real Express service, and drive that service as a separate process with real requests, real signals and real exit codes.

## Install

```bash
npm i @jtkunley/service-runtime
```

Requires Node.js 22 or later. Bring your own logger: anything that implements the small `RootLogger` interface, `child(module, action)` returning `info`, `warn` and `error`.

## Quick start

A service wired end to end. The component tests run a service much like this one, in [`test/component/fixtures/service.mts`](test/component/fixtures/service.mts).

```ts
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import {
  configureContext,
  createExpressMiddleware,
  createFetchWrapper,
  createShutdownState,
  registerFatalHandlers,
  setupGracefulShutdown,
} from '@jtkunley/service-runtime';
import { rootLogger } from './logger'; // your RootLogger implementation

registerFatalHandlers(rootLogger); // first, so a failure while starting is caught

const context = configureContext({
  tenantId: {
    value: (req) => req.headers['x-tenant-id'],
    required: true,
    forward: { header: 'x-tenant-id', to: 'internal' },
  },
  requestId: {
    value: (req) => req.headers['x-request-id']?.trim() || randomUUID(),
    forward: { header: 'x-request-id', to: 'all' },
  },
});
const state = createShutdownState();
const fetch = createFetchWrapper(context); // forwards x-tenant-id and x-request-id downstream

const app = express();
app.get('/readiness', (_req, res) => {
  res.sendStatus(state.isShuttingDown() ? 503 : 200);
});
app.use(createExpressMiddleware(context, { logger: rootLogger.child('http', 'request') }));
app.get('/orders', async (_req, res) => {
  const orders = await fetch(`https://orders.internal/tenants/${context.get('tenantId')}/orders`);
  res.json(await orders.json());
});

const server = createServer(app).listen(3000);
setupGracefulShutdown(server, rootLogger, [closeDb], { state });
```

## Request context

A service declares, once at startup, the values every request carries. Each entry has a `value` function that works it out when a request starts, and attributes that decide what happens to it. The values are held in [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html) for the rest of the request, so any code can read them without passing them through every call. The package knows nothing about what the values mean: tenancy, request IDs, locales and anything else are the service's own declarations.

### Configuring the context

```ts
import { randomUUID } from 'node:crypto';
import { configureContext } from '@jtkunley/service-runtime';

export const context = configureContext({
  // Multi-tenancy: which tenant a request acts for, so every service scopes its data to it.
  tenantId: {
    value: (req) => req.headers['x-tenant-id'],
    required: true,
    forward: { header: 'x-tenant-id', to: 'internal' },
  },
  // Request threading: one ID across every service a request touches, so its logs join up.
  requestId: {
    value: (req) => req.headers['x-request-id']?.trim() || randomUUID(),
    forward: { header: 'x-request-id', to: 'all' },
  },
});
```

| Attribute | Description |
|-----------|-------------|
| `value` | `(req) => string \| undefined`, called once at the start of each request with its headers (lower-cased names), method and path. The result is trimmed, and a blank one counts as absent. |
| `required` | Without a value, the middleware answers `400` and `run()` throws. |
| `forward` | `{ header, to }`: the fetch wrapper sends the value as `header`, to internal destinations only (`'internal'`) or to every destination (`'all'`). Without it, the value never leaves the service. |

A single-tenant service names its one tenant instead of reading the header, `value: () => process.env.TENANT_ID`, so no caller can route a request to another tenant.

A header is only as trustworthy as whatever sets it. Read the tenant from a header only behind a gateway that sets it, or strips it from outside traffic.

### Reading values

```ts
context.get('tenantId');  // string: a required entry always has a value
context.get('requestId'); // string | undefined
context.getStore();       // { tenantId, requestId }, frozen, or undefined outside a request
```

`get` accepts only configured names, and its return type follows the entry's `required` attribute. The values are frozen, so nothing can switch the tenant partway through a request.

### Logging the values

Adding the values to log lines is the logger's job, not this package's. With [`@jtkunley/logger`](https://github.com/jtkunley/logger), each value is a resolver run on every line, so everything logged inside a request carries them, including this package's own lines:

```ts
import { logger } from '@jtkunley/logger';

logger.configureContext({
  tenantId: () => context.getStore()?.tenantId,
  requestId: () => context.getStore()?.requestId,
});
```

The package's own log lines therefore carry only what the logger can't know: a rejected request's method, path and missing entries, or a shutdown's signal.

### Express middleware

```ts
import express from 'express';
import { createExpressMiddleware } from '@jtkunley/service-runtime';
import { context } from './context';
import { rootLogger } from './logger'; // your RootLogger implementation

const app = express();
app.use(createExpressMiddleware(context, { logger: rootLogger.child('http', 'request') }));
```

Works out every value at the start of each request and calls `next()` inside the context. A request missing a required value is answered `400` with `{ error: 'Missing required context value: tenantId' }` and never reaches `next()`. With a `logger`, the rejection is logged as an `error` with the method, full path and the names of the missing entries. The request never entered a context, so this is everything the logger has to go on.

### Background jobs and message consumers

```ts
await context.run({ headers: { 'x-tenant-id': tenantId } }, () => runJob());
await context.run({ headers: message.headers }, () => handle(message));
```

`run()` uses the same `value` functions as the middleware, so every value has one source of truth. It throws, naming every required entry without a value, before calling the function.

### Outgoing fetch

```ts
import { createFetchWrapper } from '@jtkunley/service-runtime';

const fetchInternal = createFetchWrapper(context);
const fetchExternal = createFetchWrapper(context, { destination: 'external' });

await fetchInternal('https://orders.internal/api/orders'); // sends x-tenant-id and x-request-id
await fetchExternal('https://api.partner.com/v1/quotes');  // sends only x-request-id
```

Inside a request, each entry forwarded to the destination is sent under its header, replacing a header of that name the caller set. Headers for entries not forwarded there are sent as the caller set them. Outside a request, the call passes through to `globalThis.fetch` unchanged.

### Request context API

#### `configureContext(config)`

Takes an object of named `ContextEntry` values and returns a `Context`. Each call creates its own store; a service normally makes one and exports it.

| `Context` method | Description |
|------------------|-------------|
| `run(source, fn)` | Works out the values from `source`, `{ headers, method?, path? }`, and runs `fn` inside the context, returning what it returns. Throws if a required value is missing. |
| `get(name)` | The value of one entry. Throws `Error('No request context')` outside a request. |
| `getStore()` | Every value, frozen, or `undefined` outside a request. |

#### `createExpressMiddleware(context, opts?)`

`opts` is `ContextMiddlewareOptions`, `{ logger?: ChildLogger }`; only `logger.error` is used.

#### `createFetchWrapper(context, options?)`

Returns a `fetch`-compatible function. `options.destination` is `'internal'` (the default) or `'external'`; an external destination gets only the entries forwarded `to: 'all'`.

#### Types

`ContextEntry`, `ContextConfig`, `ContextRequest` (what a `value` function receives), `ContextSource` (what `run()` takes) and `ContextValues<C>` (the values of a configuration) are exported for annotating your own code.

---

## Entry points

| Import | Exports |
|--------|---------|
| `@jtkunley/service-runtime` | Request context, graceful shutdown, fatal error handlers, the deployment tier, the logger types |
| `@jtkunley/service-runtime/tier` | `getTier`, `isNonProdTier`, `isProdTier`, `NON_PROD_TIER_PATTERN`, `PROD_TIER_PATTERN`, `TierEnv` |

`@jtkunley/service-runtime/tier` loads nothing but the tier check, for code that wants only that.

The root, the tier subpath and `@jtkunley/service-runtime/package.json` are the whole public surface: the `exports` map rejects deep imports into `src/`.

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

---

## Graceful shutdown

`setupGracefulShutdown` listens for SIGTERM and SIGINT. On the first signal it:

1. Marks the shutdown state, so `isShuttingDown()` is true from here and readiness can start failing
2. Runs `onShutdownStart`, if given, and waits for it (e.g. for the load balancer to stop routing to the pod)
3. Stops the server accepting connections and waits for open requests to finish, closing keep-alive connections as they go idle
4. Runs your cleanup functions one after another, in order
5. Exits with code 0, or 1 if any step failed

The whole shutdown never takes longer than `forceExitMs` (30 seconds by default); at the deadline the process exits with code 1. A step that fails is logged and the next one still runs. A repeated signal is logged and ignored, so it can't end the process in the middle of cleanup.

### Usage

Create the shutdown state when the app is built, so readiness can read it, then register shutdown once the server listens. Works the same with Express or any framework on a Node `http.Server`.

```ts
import { createServer } from 'http';
import express from 'express';
import { rootLogger } from './logger'; // your RootLogger implementation
import {
  createShutdownState,
  registerFatalHandlers,
  setupGracefulShutdown,
} from '@jtkunley/service-runtime';

registerFatalHandlers(rootLogger); // first, so a failure while starting is caught

const state = createShutdownState();
const app = express();
app.get('/readiness', (_req, res) => {
  res.sendStatus(state.isShuttingDown() ? 503 : 200);
});
// ... routes, middleware ...

const server = createServer(app);
server.listen(3000);

setupGracefulShutdown(server, rootLogger, [closeMessageQueue, closeDb], {
  state,
  onShutdownStart: () => new Promise((resolve) => setTimeout(resolve, 10_000)),
});
```

List cleanups in dependency order: close what produces work first (e.g. a message queue consumer), then shared clients (e.g. Redis, the database). They can be sync or async.

### Fatal errors

`registerFatalHandlers` logs an `uncaughtException` or `unhandledRejection` and exits with code 1 at once. The process is in an unknown state after either, so it skips graceful shutdown and leaves the restart to the orchestrator.

Neither function waits for the logger to flush before exiting. If your logger buffers its output, flush it in your last cleanup function.

### Graceful shutdown API

#### `setupGracefulShutdown(server, rootLogger, cleanupFns?, options?)`

Returns `GracefulShutdown`: `{ readonly isShuttingDown: () => boolean }`. Shutdown logs use the child logger `server` / `shutdown`; every line carries `{ signal }`, and a failed cleanup's line also carries `cleanup`, its function name or its position such as `#2`.

Call it once per process: a second call throws an `Error`. An invalid `forceExitMs` throws a `RangeError`. Either way nothing is registered.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `forceExitMs` | `number` | `30000` | The most shutdown may take, from the first signal to the exit; then the process exits with code 1. A positive integer. |
| `onShutdownStart` | `() => void \| Promise<void>` | none | Runs once, after the state is marked and before the server closes, which waits for a returned promise. |
| `state` | `ShutdownState` | a fresh one | The state to mark when shutdown begins, from `createShutdownState()`. |

#### `createShutdownState()`

Returns `ShutdownState`: `{ isShuttingDown(): boolean; begin(): void }`. `setupGracefulShutdown` calls `begin()` on the first signal. An app may call it earlier itself, for example to start failing readiness, and the first signal still shuts down.

#### `registerFatalHandlers(rootLogger)`

Registers the `uncaughtException` and `unhandledRejection` handlers. Logs use the child logger `server` / `fatal`; anything thrown that isn't an `Error` is wrapped in one and kept as its `cause`. Call it once per process: a second call throws an `Error`.

#### `CleanupFn`

```ts
type CleanupFn = () => void | Promise<void>;
```

## Related packages

- [`@jtkunley/logger`](https://github.com/jtkunley/logger): structured JSON logging on pino, whose child loggers fit the `RootLogger` interface, and whose context injection adds the request's values to every line.
- [`@jtkunley/cron`](https://github.com/jtkunley/cron): scheduled jobs that skip overlapping runs and stop cleanly. Its `runInContext` option runs each tick in a request context, `(tick) => context.run({ headers: { 'x-tenant-id': tenantId } }, tick)`, and its `stop()` belongs in the shutdown cleanups.

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
  lib/context/             configureContext, the request context itself
  lib/middleware/          Express middleware that fills the context
  lib/fetch/               fetch wrapper that forwards context values downstream
  lib/lifecycle/           graceful shutdown, shutdown state, fatal error handlers
  lib/tier/                deployment tier checks, the /tier entry point
  lib/shared/              logger types and error helpers
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
