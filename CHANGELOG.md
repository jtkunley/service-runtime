# Changelog

## 1.0.0 (2026-10-28)

### Features

- **Graceful shutdown:** `setupGracefulShutdown` handles SIGTERM and SIGINT. It marks a shutdown state for readiness, runs an optional `onShutdownStart` hook, closes the HTTP server while closing keep-alive connections as they go idle, runs cleanup functions in order, and exits within a `forceExitMs` deadline. `createShutdownState` creates the state before the server listens.
- **Fatal error handlers:** `registerFatalHandlers` logs an uncaught exception or unhandled rejection and exits with code 1.
- **Request context:** `run`, `getOrganizationId`, `getCorrelationId` and `getStore` carry the organization and correlation IDs through `AsyncLocalStorage`. Express and Koa middleware set the context from request headers, and `createFetchWrapper` adds the IDs to outgoing requests.
- **Deployment tier:** `getTier`, `isNonProdTier` and `isProdTier`, also on the `service-runtime/tier` subpath.
- **Scheduled jobs:** `createCron` on the `service-runtime/cron` subpath, with overlap control, error hooks and a `stop()` that waits for runs in progress.
