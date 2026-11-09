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
import { logger } from "./logger.js";

const service = configureService({
  logger,
  port: 3000,
  context: {
    tenant: {
      value: (request) => request.headers["x-tenant-id"],
      required: true,
      header: "x-tenant-id",
    },
    requestId: {
      value: (request) => request.headers["x-request-id"] ?? crypto.randomUUID(),
      header: "x-request-id",
    },
  },
  destinations: {
    billing: ["tenant", "requestId"],
  },
  cleanups: [() => database.close()],
});

const app = express();
app.use(service.middleware);

app.get("/invoices", async (_req, res) => {
  const tenant = service.context.get("tenant"); // string
  const invoices = await fetch("https://billing.internal/invoices", {
    headers: service.context.getHeaders("billing"),
  });
  res.json({ tenant, invoices: await invoices.json() });
});

const address = await service.listen(app);
logger.child("app", "startup").info("Listening", { port: address.port });
```

## Configuration

`configureService(options)` validates its options and returns a service. It throws synchronously on invalid input. Configuring a service opens no sockets and installs no process handlers, so you can configure several services before listening. The options are copied when the service is created, so later changes to them have no effect.

| Option               | Default                   | Description                                                                           |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| `logger`             | required                  | Root logger (see [Logging](#logging)).                                                |
| `port`               | required                  | Integer from 0 through 65535. `0` picks an available port.                            |
| `host`               | Node's default            | Interface to bind.                                                                    |
| `context`            | `{}`                      | Context entries (see [Request context](#request-context)).                            |
| `destinations`       | `{}`                      | Named sets of context entries to forward (see [Outbound headers](#outbound-headers)). |
| `probes`             | `/readiness`, `/liveness` | Custom probe paths, or `false` to disable a probe.                                    |
| `cleanups`           | `[]`                      | Functions run sequentially, in order, after the server closes.                        |
| `onShutdownStart`    | none                      | Awaited when shutdown starts, before the server stops accepting connections.          |
| `shutdownSignals`    | `["SIGTERM", "SIGINT"]`   | Signals that start graceful shutdown. `SIGKILL` and `SIGSTOP` are rejected.           |
| `forceExitMs`        | `30000`                   | Graceful shutdown deadline, measured from the first signal.                           |
| `keepAliveTimeoutMs` | `65000`                   | HTTP keep-alive timeout. The headers timeout is set 1,000 ms higher.                  |

Invalid ports and timeouts throw `RangeError`. Other invalid options throw `TypeError`.

## Request context

Each context entry declares a synchronous `value(request)` resolver. The resolver receives lower-cased header names (repeated headers are joined with `", "`), the method, and the path without its query string. Returned strings are trimmed. `undefined`, empty strings, and whitespace-only strings count as absent.

```ts
context: {
  tenant: { value: (r) => r.headers["x-tenant-id"], required: true },
  locale: { value: (r) => r.headers["accept-language"] ?? "en" },
}
```

Types are inferred from the configuration: `required: true` entries are typed as `string`, other entries as `string | undefined`. Unknown keys and unknown entry attributes are compile-time errors.

### HTTP middleware

`service.middleware` is Express-compatible middleware. Install it before the routes that need context. It resolves every entry once and runs the downstream middleware and routes inside that context, including mounted routers, body parsing, and async work.

If required values are missing, the middleware responds with status `400` and `{ "error": "Missing required context value: tenant" }`, and downstream code does not run. The rejection is logged through `server/context` with `{ method, path, missing }`. Headers, query strings, and resolved values are never logged. If a resolver throws, the error is passed to `next(error)` so your framework's error handling deals with it.

### Programmatic context

Use `context.run` for work that isn't triggered by HTTP, such as queue consumers or scheduled jobs:

```ts
await service.context.run({ headers: { "x-tenant-id": job.tenant } }, async () => {
  await processJob(job);
});
```

`run` returns exactly what the callback returns, including promises. It throws before invoking the callback if required values are missing. Nested calls temporarily replace the current values and restore the outer context afterwards.

| Method                     | Inside a context           | Outside a context           |
| -------------------------- | -------------------------- | --------------------------- |
| `context.get(name)`        | The value                  | Throws `No request context` |
| `context.getStore()`       | All values (immutable)     | `undefined`                 |
| `context.getHeaders(dest)` | That destination's headers | `{}`                        |

The runtime does not configure your logger's context automatically. To include context values in log lines, read them with `getStore()` in your logger setup.

## Outbound headers

Destinations list the context entries each downstream service may receive. Every listed entry must declare a `header`.

```ts
destinations: {
  billing: ["tenant", "requestId"],
  analytics: ["requestId"],
}
```

`context.getHeaders("billing")` returns a fresh object containing only that destination's currently defined values, keyed by their configured header names. Header names are validated when the service is configured. Values are validated when headers are generated: an invalid value throws a `TypeError` that names the entry and header but not the value. Undeclared destinations throw `Unknown destination: <name>`. The runtime never makes network requests itself; you apply the headers to your own outgoing requests.

## Health probes

Probe requests (`GET` or `HEAD`) are answered before your application and before the context middleware runs. Probe responses have empty bodies, and query strings are ignored when matching.

| Probe       | Serving normally | Shutting down or fatal exit |
| ----------- | ---------------- | --------------------------- |
| `readiness` | `200`            | `503`                       |
| `liveness`  | `200`            | `200` while reachable       |

## Listening and shutdown

`service.listen(app)` starts an HTTP server owned by the runtime. It accepts any Node request listener, including an Express app, and resolves with the bound address. Only one service can listen per process. If startup fails, everything the attempt opened is closed again and the reservation is released, so you can retry.

When the first shutdown signal arrives, the runtime:

1. Starts failing readiness and awaits `onShutdownStart`.
2. Stops accepting new connections and waits for active requests to finish. Idle keep-alive connections are closed promptly.
3. Runs `cleanups` one at a time, in declaration order.
4. Flushes the logger and exits with `0`. If any step failed, it exits with `1`.

A failing step is logged and the sequence continues. If the `forceExitMs` deadline expires first, the runtime logs a timeout and exits with `1` without waiting for unfinished work. Repeated signals are logged and ignored.

Uncaught exceptions and unhandled rejections are logged through `server/fatal`, and the process exits with `1` without running graceful cleanup.

`service.isShuttingDown()` becomes `true` when shutdown or a fatal exit begins, and never resets.

## Logging

Bring your own logger. The root logger needs a `child(module, action)` method, and can optionally provide a `flush()` method:

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
