# service-runtime

A zero-dependency HTTP service runtime for Node.js. It handles the operational parts of running a service so your application code doesn't have to:

- **Context propagation.** Values resolved from each request travel as headers on outgoing calls, through a native `fetch` that adds them for you. You choose which values each downstream service receives.
- **Health probes.** Readiness and liveness endpoints that track the shutdown state.
- **Graceful shutdown.** Drain in-flight requests, run cleanups in order, and enforce a deadline.
- **Fatal-error handling.** Uncaught exceptions and unhandled rejections are logged, and the process exits once.

```sh
npm install service-runtime
```

Requires Node.js 22.12 or later, and TypeScript 5.4 or later if you use the types. The package is ESM, and `require()` also works on supported Node versions.

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

### Forward request context downstream

Declare context entries with an outbound `header`, install the middleware, and create a fetch with `service.createFetch()`. It's Node's native `fetch`, and every call made during a request carries that request's headers. Mark an entry `required: true` to reject requests without it with a `400`, before your routes run.

```ts
const service = configureService({
  logger,
  port: 3000,
  context: {
    tenant: { value: (r) => r.headers["x-tenant-id"], required: true, header: "x-tenant-id" },
    requestId: {
      value: (r) => r.headers["x-request-id"] ?? crypto.randomUUID(),
      header: "x-request-id",
    },
  },
});

const contextFetch = service.createFetch();

app.use(service.middleware);

app.get("/invoices", async (_req, res) => {
  // Sends x-tenant-id and x-request-id.
  const response = await contextFetch("https://billing.internal/invoices");
  res.json(await response.json());
});
```

Create the fetch once and reuse it: each call picks up the headers of the request it runs in. Headers you pass to a call win over context headers of the same name:

```ts
await contextFetch(url, { headers: { "x-request-id": "replay-42" } });
```

### Choose what each service receives

Without `destinations`, every entry with a header is forwarded. Declare `destinations` to forward less, and create one fetch per destination: no name sends `default`, a name sends that destination, and an array combines several.

```ts
destinations: {
  default: ["tenant", "requestId"],
  analytics: ["requestId"],
  audit: ["tenant"],
},
```

```ts
const billingFetch = service.createFetch(); // tenant and requestId
const analyticsFetch = service.createFetch("analytics"); // requestId only
const reportingFetch = service.createFetch(["analytics", "audit"]); // requestId and tenant
```

### Use another HTTP client

`context.getHeaders()` returns the same headers as a plain object, for axios, got, undici, or your own fetch. It takes the same destination arguments as `createFetch`.

```ts
await axios.get("https://billing.internal/invoices", {
  headers: service.context.getHeaders(),
});
```

### Use context outside HTTP

Queue consumers and scheduled jobs establish the same context with `context.run`:

```ts
await service.context.run({ headers: { "x-tenant-id": job.tenant } }, async () => {
  await contextFetch(job.callbackUrl);
});
```

### Shut down cleanly

`onShutdownStart` runs when a shutdown signal arrives, while requests drain. `cleanups` then run one at a time, in order. Long-running work can check `service.isShuttingDown()` to stop early.

```ts
const service = configureService({
  logger,
  port: 3000,
  onShutdownStart: () => queue.pause(),
  cleanups: [() => queue.close(), () => database.close()],
});
```

Shutdown starts on `SIGTERM` or `SIGINT` and must finish within 30 seconds. Probes live at `/readiness` and `/liveness`. Override any of these when you need to:

```ts
probes: { readiness: "/ready", liveness: false },
shutdownSignals: ["SIGTERM"], // replaces the default list
forceExitMs: 10_000,
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

## Reference

### API

| Member                              | Description                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `configureService(options)`         | Validates options and returns a service (see [Configuration](#configuration)).               |
| `service.middleware`                | Express-compatible middleware that resolves the request's context.                           |
| `service.createFetch(destination?)` | Node's `fetch`, sending the destination's context headers on every call.                     |
| `service.context.getHeaders(dest?)` | The destination's context headers as a plain object, for other HTTP clients.                 |
| `service.context.run(source, fn)`   | Runs `fn` inside a context resolved from `source`, for work outside HTTP.                    |
| `service.listen(app)`               | Starts the HTTP server, probes, and signal handling; resolves with the address.              |
| `service.isShuttingDown()`          | `true` once shutdown or a fatal exit has begun.                                              |
| `service.context.get` / `getStore`  | Direct value reads; rarely needed (see [Reading values directly](#reading-values-directly)). |

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

Each context entry declares a synchronous `value(request)` resolver. The resolver receives lower-cased header names (repeated headers are joined with `", "`), the method, and the path without its query string. Returned strings are trimmed. `undefined`, empty strings, and whitespace-only strings count as absent. Unknown entry attributes are compile-time errors.

`service.middleware` is Express-compatible middleware. It resolves every entry once and runs the downstream middleware and routes inside that context, including mounted routers, body parsing, and async work. If required values are missing, it responds with status `400` and `{ "error": "Missing required context value: tenant" }`, and logs the rejection through `server/context` with `{ method, path, missing }`; headers, query strings, and values are never logged. If a resolver throws, the error is passed to `next(error)`.

`context.run(source, fn)` returns exactly what the callback returns, including promises. It throws before invoking the callback if required values are missing. Nested calls temporarily replace the current values and restore the outer context afterwards.

### Outbound headers

`service.createFetch(destination?)` returns Node's global `fetch`, wrapped so each call sends the current context's headers for the destination. Headers passed to a call take precedence over context headers of the same name; with a `Request` input, its own headers count as passed unless the call also supplies `headers`. Calls outside a context send no context headers. Like `fetch`, every failure, including an invalid header, rejects the returned promise. The destination is checked when the fetch is created.

`context.getHeaders(destination?)` returns a fresh object with the destination's currently defined values, keyed by header name, or `{}` outside a context.

Both take the same destination argument:

- Without `destinations`, a single `default` destination contains every entry that declares a `header`.
- With `destinations`, only the listed entries are forwarded. Omitting the name requires a `default` destination; otherwise it's a type error and throws `Unknown destination: default`.
- An array of names combines destinations, including each entry once.
- Listed entries must declare a `header`, and two entries in one destination cannot share a header name (case-insensitive). Both are checked at configuration. A clash between combined destinations throws when `createFetch` is called, or when `getHeaders` is called with that list.
- Declare `destinations` inline, or with `as const` when it lives in a separate variable, so entry names keep their literal types.
- Header names are validated at configuration. An invalid value throws a `TypeError` naming the entry and header, but not the value, when headers are generated. Undeclared destinations throw `Unknown destination: <name>`.

### Reading values directly

Most services should not need these. Context is meant to travel through `createFetch()` or `getHeaders()`, and destinations decide what each service receives. Reach for direct reads only when a value is used inside your own service and never forwarded, such as adding it to your logger's context.

| Method               | Inside a context                          | Outside a context           |
| -------------------- | ----------------------------------------- | --------------------------- |
| `context.get(name)`  | The value (`string` for required entries) | Throws `No request context` |
| `context.getStore()` | All values, frozen                        | `undefined`                 |

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
