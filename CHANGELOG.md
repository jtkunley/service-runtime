# Changelog

## 1.0.0 (2026-10-28)

### Features

- **One entry point:** `configureService` returns the service: its request context, Express middleware, `onShutdown` for cleanups, and `listen`, which registers the fatal error handlers and starts the server with health probes and graceful shutdown. Nothing process-wide happens before `listen`, so app code importing the service is safe to test. The parts it is built from are kept private.
- **Request context:** the service declares the values every request carries. Each entry has a function that works out its value when a request starts, and attributes for whether it is required and which header it travels under; an unknown attribute is a compile error. The middleware rejects a request missing a required value, and `context.run()` does the same for jobs and message consumers. `context.getHeaders(destination)` returns the headers for a call to one of the service's declared destinations, each listing the values it receives, for any HTTP client or message producer to send.
- **Health probes:** `/readiness` and `/liveness` are answered before the app sees a request, so they never need context values. Readiness fails once shutdown starts; liveness never does.
- **Graceful shutdown:** on SIGTERM or SIGINT, readiness fails, an optional `onShutdownStart` hook runs, the server closes while closing keep-alive connections as they go idle, cleanups run in order, and the process exits within a `forceExitMs` deadline.
- **Fatal error handling:** an uncaught exception or unhandled rejection is logged and the process exits with code 1.
- **Log flushing:** a `RootLogger` may have a `flush()`, which every exit, clean, forced or fatal, awaits for up to a second.
- **Deployment tier:** `getTier`, `isNonProdTier` and `isProdTier`, also on the `@jtkunley/service-runtime/tier` subpath.
