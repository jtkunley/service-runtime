# Changelog

## 1.0.0 (2026-10-28)

### Features

- **Graceful shutdown:** `setupGracefulShutdown` handles SIGTERM and SIGINT. It marks a shutdown state for readiness, runs an optional `onShutdownStart` hook, closes the HTTP server while closing keep-alive connections as they go idle, runs cleanup functions in order, and exits within a `forceExitMs` deadline. `createShutdownState` creates the state before the server listens.
- **Fatal error handlers:** `registerFatalHandlers` logs an uncaught exception or unhandled rejection and exits with code 1.
- **Request context:** `configureContext` declares the values every request carries. Each entry has a function that works out its value when a request starts, and attributes for whether it is required and where it is forwarded downstream; an unknown attribute is a compile error. Express middleware fills the context and rejects a request missing a required value, `run()` does the same for jobs and message consumers, and `createFetchWrapper` forwards the values to internal or external destinations.
- **Deployment tier:** `getTier`, `isNonProdTier` and `isProdTier`, also on the `@jtkunley/service-runtime/tier` subpath.
