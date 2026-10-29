# service-runtime

Utilities for Node.js HTTP servers: **request context** via `AsyncLocalStorage`, the **deployment tier**, **graceful shutdown**, and **`createCron`** for scheduled work.

## Contents

- [Install](#install)
- [Request context](#request-context)
  - [Basic usage](#basic-usage)
  - [Express middleware](#express-middleware)
  - [Koa middleware](#koa-middleware)
  - [Background jobs and cron](#background-jobs-and-cron)
  - [Outgoing fetch](#outgoing-fetch)
  - [API](#request-context-api)
- [Entry points](#entry-points)
- [Deployment tier](#deployment-tier)
- [Graceful shutdown](#graceful-shutdown)
  - [Usage](#usage)
  - [Fatal errors](#fatal-errors)
  - [API](#graceful-shutdown-api)
- [Scheduled jobs (`createCron`)](#scheduled-jobs-createcron)
  - [Basic usage](#basic-usage-2)
  - [Logger, overlap, and error hook](#logger-overlap-and-error-hook)
  - [Stopping with graceful shutdown](#stopping-with-graceful-shutdown)
  - [API](#scheduled-jobs-api)

The `main` and `types` fields in package.json point to built output (`./src/index.js` and `./src/index.d.ts`). `npm run build` compiles them into `dist/src/` and copies `package.json`, this README and the changelog into `dist/`, which is the directory to publish (`npm publish dist`).

## Development

Requires Node.js 22 or later.

```bash
npm install
npm run check           # typecheck, lint and test
npm run test:unit       # unit tests, next to the source in src/
npm run test:component  # component tests in test/component/
npm run test:coverage   # tests with a v8 coverage report in coverage/
npm run build           # compile the publishable package into dist/
```

The component tests build the package as it is published, install it beside a small Express service in `test/component/fixtures/`, and run that service as a real process: real requests, real signals, real exit codes. The fixture is TypeScript run directly by Node, which needs Node.js 22.18 or later.

## Install

```bash
npm i service-runtime
```

## Request context

Carries `orgId` and `requestId` through [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html) for the lifetime of a request, message, or job. Any layer reads either value on demand — no parameter threading.

### Basic usage

At a service boundary, call `run()` to establish the scope. Everything that runs inside the callback (including awaited async work) can read the context.

```ts
import { run, getOrgId, getRequestId } from 'service-runtime';

await run({ orgId: 'org-abc', requestId: 'req-123' }, async () => {
  await processRequest(); // getOrgId() returns 'org-abc' anywhere in the call stack
});
```

`requestId` is optional — a UUID is generated automatically if omitted.

### Express middleware

```ts
import express from 'express';
import { rootLogger } from './logger'; // your RootLogger implementation
import { createExpressMiddleware } from 'service-runtime';

const app = express();
const logger = rootLogger.child('http', 'request');

app.use(createExpressMiddleware({
  getDefaultOrgId: () => process.env.ORG_ID, // single-tenant services only
  logger,
}));
```

Reads `x-org-id` and `x-request-id` from the request headers and calls `next()` inside `run()`, generating a request ID when there is none.

- **Multi-tenant** (no `getDefaultOrgId`): the org ID must come from the caller. A request without one is answered `400` with `{ error: 'Missing required header: x-org-id' }` and never reaches `next()`.
- **Single-tenant** (`getDefaultOrgId` returns an org): every request runs under that org, whatever its header says. There is only one tenant the service can serve, so a different header can't misroute data.

With a `logger`, a missing request ID is logged as a `warn` and a rejected request as an `error`, both with the method, full path, IDs and user agent. A request missing both gets both lines.

### Koa middleware

```ts
import Koa from 'koa';
import { rootLogger } from './logger'; // your RootLogger implementation
import { createKoaMiddleware } from 'service-runtime';

const app = new Koa();
const logger = rootLogger.child('http', 'request');

app.use(createKoaMiddleware({
  getDefaultOrgId: () => process.env.ORG_ID,
  logger,
}));
```

Same behaviour as the Express variant.

### Background jobs and cron

```ts
import { run } from 'service-runtime';

await run({ orgId: process.env.ORG_ID! }, () => runJob());
```

### Outgoing fetch

```ts
import { createFetchWrapper } from 'service-runtime';

const fetch = createFetchWrapper();

// Inside a context scope, both headers are injected automatically:
const res = await fetch('https://downstream-service/api/resource');
// x-org-id and x-request-id injected from current context
```

Outside a context scope, the call passes through to `globalThis.fetch` unmodified.

For third-party destinations, opt out of injecting the org ID header. The request ID is still sent for end-to-end tracing. Disabling an option only stops injection - headers the caller sets explicitly are sent as-is:

```ts
const externalFetch = createFetchWrapper({ orgId: false });
```

### Request context API

#### Constants

```ts
export const ORG_ID_HEADER = 'x-org-id';
export const REQUEST_ID_HEADER = 'x-request-id';
```

#### `run<T>(ctx, fn)`

| Argument | Type | Description |
|----------|------|-------------|
| `ctx.orgId` | `string` | Required. |
| `ctx.requestId` | `string` | Optional — UUID generated if absent. |
| `fn` | `() => T` | Sync or async callback run within the context scope. |

Returns whatever `fn` returns.

#### `getOrgId()`

Returns the current `orgId`. Throws `Error('No request context')` if called outside a `run()` scope.

#### `getRequestId()`

Returns the current `requestId`. Throws `Error('No request context')` if called outside a `run()` scope.

#### `getStore()`

Returns the current `RequestContext`, `{ orgId, requestId }`, or `undefined` if called outside a scope. Use for conditional checks where throwing is undesirable. The context is frozen, so no code can switch the tenant partway through a request.

IDs are trimmed, and a blank ID counts as absent: a blank `orgId` throws, and a blank `requestId` is replaced with a UUID.

#### `createExpressMiddleware(opts?)`

Takes `ContextMiddlewareOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `getDefaultOrgId` | `() => string \| undefined` | — | Single-tenant: the org every request runs under, read on each request. A blank value counts as none. |
| `logger` | `ChildLogger` (only `warn` and `error` are used) | — | Logs a missing request ID (`warn`) and a rejected request (`error`). |

#### `createKoaMiddleware(opts?)`

Same options as `createExpressMiddleware`.

#### `createFetchWrapper(options?)`

Returns a `fetch`-compatible function. When called inside a `run()` scope, it injects `x-org-id` and `x-request-id` from the current context into every outbound request, merging with any headers the caller already set.

| Option | Default | Description |
|--------|---------|-------------|
| `orgId` | `true` | Inject `x-org-id`. Set `false` for third-party APIs. |
| `requestId` | `true` | Inject `x-request-id`. |

---

## Entry points

| Import | Exports |
|--------|---------|
| `service-runtime` | Request context, graceful shutdown, fatal error handlers, the deployment tier, the logger types |
| `service-runtime/cron` | `createCron`, `CronOptions`, `CronController` |
| `service-runtime/tier` | `getTier`, `isNonProdTier`, `isProdTier`, `NON_PROD_TIER_PATTERN`, `PROD_TIER_PATTERN`, `TierEnv` |

`node-cron` is the package's only runtime dependency, so `createCron` lives on its own subpath: a service that doesn't schedule jobs never loads it. `service-runtime/tier` loads nothing but the tier check, for code that wants only that.

The root, these subpaths and `service-runtime/package.json` are the whole public surface: the `exports` map rejects deep imports into `src/`.

## Deployment tier

`TIER` names the deployment a process runs in. Gate what must never reach production (mock adapters, an interactive API console) on `isNonProdTier`, and what must only run in production (real integrations, paging) on `isProdTier`. A tier on neither list, unset included, passes neither check, so an unknown deployment unlocks nothing.

```ts
import { getTier, isNonProdTier } from 'service-runtime/tier';

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

Create the shutdown state when the app is built, so readiness can read it, then register shutdown once the server listens. Works the same with Express, Koa, or any framework on a Node `http.Server`.

```ts
import { createServer } from 'http';
import express from 'express';
import { rootLogger } from './logger'; // your RootLogger implementation
import {
  createShutdownState,
  registerFatalHandlers,
  setupGracefulShutdown,
} from 'service-runtime';

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

---

## Scheduled jobs (`createCron`)

`createCron` wraps [`node-cron`](https://www.npmjs.com/package/node-cron): you provide a cron expression, an async `run()` body, optional logging, and whether overlapping ticks are allowed. Call `start()` when the process should begin scheduling; call `await stop()` before exit (for example from a `setupGracefulShutdown` cleanup) so the scheduler stops and, by default, in-flight work can finish.

Errors inside `run()` are handled per tick: they are logged when you pass `logger`, and forwarded to `onError` when you set it. The schedule keeps running; a failed tick does not tear down the cron task.

### Basic usage

```ts
import { createCron } from 'service-runtime/cron';

const job = createCron({
  name: 'nightly-sync',
  schedule: '0 2 * * *', // 02:00 daily (standard 5-field node-cron expression)
  run: async () => {
    await syncSomething();
  },
});

job.start();

// On shutdown:
// await job.stop();
```

### Logger, overlap, and error hook

```ts
const job = createCron({
  name: 'poll-queue',
  schedule: '*/5 * * * *', // every 5 minutes
  run: async () => {
    await drainQueue();
  },
  logger: childLogger, // any ChildLogger
  allowOverlap: false, // default: skip a tick if the previous run is still in progress
  onError: (err) => {
    Sentry.captureException(err); // optional; failures still go to logger?.error when provided
  },
  waitForCompletionOnStop: true, // default: stop() awaits in-flight run() calls
});
```

### Stopping with graceful shutdown

Add `job.stop()` as a cleanup so the scheduler stops when the process receives SIGTERM:

```ts
const job = createCron({ name: 'x', schedule: '*/5 * * * *', run: doWork });
job.start();

setupGracefulShutdown(server, rootLogger, [() => job.stop()]);
```

### Scheduled jobs API

Exports: `createCron`, `CronOptions`, `CronController`.

#### `createCron(options)`

Returns a `CronController`. The `node-cron` task is created stopped, named after the job, and only starts scheduling when you call `start()`.

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Used in log messages. |
| `schedule` | `string` | Yes | — | Cron expression accepted by `node-cron`. |
| `run` | `() => Promise<void>` | Yes | — | Async work for each tick. |
| `logger` | `ChildLogger` | No | — | Optional logger for lifecycle and error messages. |
| `onError` | `(error: unknown) => void` | No | — | Optional hook when `run()` throws or rejects (e.g. error reporting, metrics). |
| `allowOverlap` | `boolean` | No | `false` | If `false`, a tick is skipped while the prior `run()` is still running (`warn` logged). |
| `waitForCompletionOnStop` | `boolean` | No | `true` | If `true`, `stop()` awaits pending `run()` invocations. |

#### `CronController`

| Method | Description |
|--------|-------------|
| `start()` | Starts the underlying `node-cron` task. Idempotent. |
| `stop()` | Stops scheduling; by default waits for in-flight runs (see `waitForCompletionOnStop`). |
| `isStarted()` | Whether `start()` has been called without a subsequent `stop()`. |
| `isActive()` | Whether at least one `run()` is currently in progress. |
