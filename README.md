# service-runtime

A zero-dependency HTTP service runtime for Node.js. It handles the operational parts of running a service so your application code doesn't have to:

- **Scoped request context.** Values resolved from each request are available anywhere in its async call chain.
- **Outbound context headers.** Pick which context values are forwarded to each downstream service.
- **Health probes.** Readiness and liveness endpoints that track the shutdown state.
- **Graceful shutdown.** Drain in-flight requests, run cleanups in order, and enforce a deadline.
- **Fatal-error handling.** Uncaught exceptions and unhandled rejections are logged, and the process exits once.

```sh
npm install service-runtime
```

Requires Node.js 22.12 or later. The package is ESM, and `require()` also works on supported Node versions.

## Quick start

```ts
import express from "express";
import { configureService } from "service-runtime";
import { logger } from "./logger.js"; // see "Bring your own logger"

const service = configureService({ logger, port: 3000 });

const app = express();
app.get("/", (_req, res) => res.send("ok"));

await service.listen(app);
```

That's a running service with `/readiness` and `/liveness` probes, graceful shutdown on `SIGTERM` and `SIGINT`, and fatal-error handling. Each example below adds one feature to it.

## Examples

### Read values from each request

Declare context entries, install the middleware, and read the values anywhere in the request's async call chain, with no need to pass them through function arguments.

```ts
const service = configureService({
  logger,
  port: 3000,
  context: {
    requestId: { value: (request) => request.headers["x-request-id"] ?? crypto.randomUUID() },
  },
});

app.use(service.middleware);

app.get("/", (_req, res) => {
  res.send(service.context.get("requestId"));
});
```

### Require a value

Mark an entry `required: true` to reject requests that don't provide it. They get a `400` response, and your routes never run. Required entries are typed as `string` instead of `string | undefined`.

```ts
context: {
  tenant: { value: (request) => request.headers["x-tenant-id"], required: true },
},
```

```ts
const tenant = service.context.get("tenant"); // string
```

### Forward context to downstream services

Give entries an outbound `header`. `getHeaders()` then returns every one of them that has a value, ready to attach to your outgoing requests.

```ts
const service = configureService({
  logger,
  port: 3000,
  context: {
    tenant: { value: (r) => r.headers["x-tenant-id"], required: true, header: "x-tenant-id" },
    requestId: { value: (r) => r.headers["x-request-id"], header: "x-request-id" },
  },
});

app.get("/invoices", async (_req, res) => {
  const response = await fetch("https://billing.internal/invoices", {
    headers: service.context.getHeaders(),
  });
  res.json(await response.json());
});
```

### Send different headers to different services

Declare `destinations` when some services should receive less. Once you do, only the listed entries are forwarded: `default` is what `getHeaders()` sends, and every other destination must be named.

```ts
destinations: {
  default: ["tenant", "requestId"],
  analytics: ["requestId"],
},
```

```ts
await fetch("https://analytics.example.com/events", {
  method: "POST",
  headers: service.context.getHeaders("analytics"), // { "x-request-id": "..." }
});
```

### Use context outside HTTP

Queue consumers and scheduled jobs can establish the same context with `context.run`.

```ts
await service.context.run({ headers: { "x-tenant-id": job.tenant } }, async () => {
  await processJob(job); // context.get("tenant") and getHeaders() work in here
});
```

### Include context in your logs

The runtime doesn't touch your logger's context. Read the current values with `getStore()` when writing log lines.

```ts
function log(message: string) {
  console.log(JSON.stringify({ message, ...service.context.getStore() }));
}
```

### Close resources on shutdown

`cleanups` run one at a time, in order, after in-flight requests finish. `onShutdownStart` runs first, while the server is still draining.

```ts
const service = configureService({
  logger,
  port: 3000,
  onShutdownStart: () => queue.pause(),
  cleanups: [() => queue.close(), () => database.close()],
});
```

Long-running work can check `service.isShuttingDown()` to stop early.

### Customize health probes

Move a probe to another path, or turn one off with `false`.

```ts
probes: { readiness: "/ready", liveness: false },
```

### Tune shutdown and timeouts

```ts
const service = configureService({
  logger,
  port: 3000,
  host: "0.0.0.0",
  shutdownSignals: ["SIGTERM"],
  forceExitMs: 10_000,
  keepAliveTimeoutMs: 75_000,
});
```

### Bring your own logger

Any logger with a `child(module, action)` method works. This one writes to the console:

```ts
import type { Logger } from "service-runtime";

export const logger: Logger = {
  child: (module, action) => ({
    info: (message, data) => console.log(module, action, message, data),
    error: (message, error, data) => console.error(module, action, message, error, data),
  }),
};
```

Add an optional `flush()` method if your logger buffers output. The runtime calls it before exiting.

## Reference

### Configuration

`configureService(options)` validates its options and returns a service. It throws synchronously on invalid input. Configuring a service opens no sockets and installs no process handlers, so you can configure several services before listening. The options are copied when the service is created, so later changes to them have no effect.

| Option               | Default                   | Description                                                                           |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| `logger`             | required                  | Root logger (see [Logging](#logging)).                                                |
| `port`               | required                  | Integer from 0 through 65535. `0` picks an available port.                            |
| `host`               | Node's default            | Interface to bind.                                                                    |
| `context`            | `{}`                      | Context entries (see [Request context](#request-context)).                            |
| `destinations`       | every header in `default` | Named sets of context entries to forward (see [Outbound headers](#outbound-headers)). |
| `probes`             | `/readiness`, `/liveness` | Custom probe paths, or `false` to disable a probe.                                    |
| `cleanups`           | `[]`                      | Functions run sequentially, in order, after the server closes.                        |
| `onShutdownStart`    | none                      | Awaited when shutdown starts, before the server stops accepting connections.          |
| `shutdownSignals`    | `["SIGTERM", "SIGINT"]`   | Signals that start graceful shutdown. `SIGKILL` and `SIGSTOP` are rejected.           |
| `forceExitMs`        | `30000`                   | Graceful shutdown deadline, measured from the first signal.                           |
| `keepAliveTimeoutMs` | `65000`                   | HTTP keep-alive timeout. The headers timeout is set 1,000 ms higher.                  |

Invalid ports and timeouts throw `RangeError`. Other invalid options throw `TypeError`.

### Request context

Each context entry declares a synchronous `value(request)` resolver. The resolver receives lower-cased header names (repeated headers are joined with `", "`), the method, and the path without its query string. Returned strings are trimmed. `undefined`, empty strings, and whitespace-only strings count as absent.

Types are inferred from the configuration: `required: true` entries are typed as `string`, other entries as `string | undefined`. Unknown keys and unknown entry attributes are compile-time errors.

`service.middleware` is Express-compatible middleware. Install it before the routes that need context. It resolves every entry once and runs the downstream middleware and routes inside that context, including mounted routers, body parsing, and async work.

If required values are missing, the middleware responds with status `400` and `{ "error": "Missing required context value: tenant" }`, and downstream code does not run. The rejection is logged through `server/context` with `{ method, path, missing }`. Headers, query strings, and resolved values are never logged. If a resolver throws, the error is passed to `next(error)` so your framework's error handling deals with it.

`context.run(source, fn)` returns exactly what the callback returns, including promises. It throws before invoking the callback if required values are missing. Nested calls temporarily replace the current values and restore the outer context afterwards.

| Method                      | Inside a context           | Outside a context           |
| --------------------------- | -------------------------- | --------------------------- |
| `context.get(name)`         | The value                  | Throws `No request context` |
| `context.getStore()`        | All values (immutable)     | `undefined`                 |
| `context.getHeaders(dest?)` | That destination's headers | `{}`                        |

### Outbound headers

Destinations list the context entries each downstream service may receive. Every listed entry must declare a `header`, and two entries in the same destination cannot share a header name.

A destination named `default` is used when you call `context.getHeaders()` without a name. Other destinations must be named explicitly.

If you don't declare `destinations`, there is a single `default` destination containing every entry that declares a `header`, so those entries' headers must not clash. If you declare `destinations` without a `default`, calling `getHeaders()` without a name is a type error, and throws `Unknown destination: default` at runtime.

`getHeaders` returns a fresh object containing only that destination's currently defined values, keyed by their configured header names. Header names are validated when the service is configured. Values are validated when headers are generated: an invalid value throws a `TypeError` that names the entry and header but not the value. Undeclared destinations throw `Unknown destination: <name>`. The runtime never makes network requests itself; you apply the headers to your own outgoing requests.

### Health probes

Probe requests (`GET` or `HEAD`) are answered before your application and before the context middleware runs. Probe responses have empty bodies, and query strings are ignored when matching.

| Probe       | Serving normally | Shutting down or fatal exit |
| ----------- | ---------------- | --------------------------- |
| `readiness` | `200`            | `503`                       |
| `liveness`  | `200`            | `200` while reachable       |

### Listening and shutdown

`service.listen(app)` starts an HTTP server owned by the runtime. It accepts any Node request listener, including an Express app, and resolves with the bound address. Only one service can listen per process. If startup fails, everything the attempt opened is closed again and the reservation is released, so you can retry.

When the first shutdown signal arrives, the runtime:

1. Starts failing readiness and awaits `onShutdownStart`.
2. Stops accepting new connections and waits for active requests to finish. Idle keep-alive connections are closed promptly.
3. Runs `cleanups` one at a time, in declaration order.
4. Flushes the logger and exits with `0`. If any step failed, it exits with `1`.

A failing step is logged and the sequence continues. If the `forceExitMs` deadline expires first, the runtime logs a timeout and exits with `1` without waiting for unfinished work. Repeated signals are logged and ignored.

Uncaught exceptions and unhandled rejections are logged through `server/fatal`, and the process exits with `1` without running graceful cleanup.

`service.isShuttingDown()` becomes `true` when shutdown or a fatal exit begins, and never resets.

### Logging

The root logger needs a `child(module, action)` method, and can optionally provide a `flush()` method:

```ts
interface Logger {
  child(
    module: string,
    action: string,
  ): {
    info(message: string, data: Record<string, unknown>): void;
    error(message: string, error: Error, data: Record<string, unknown>): void;
  };
  flush?(): Promise<void>;
}
```

The runtime logs through `server/context`, `server/shutdown`, and `server/fatal`. Before any exit it calls `flush()` and waits at most one second. A throwing, rejected, or hanging flush does not block the exit or change the exit code.

## License

[MIT](./LICENSE)
