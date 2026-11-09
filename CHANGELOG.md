# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.0.1

Initial npm release.

- `configureService(options)` with synchronous validation and configuration snapshots.
- Scoped request context with typed entries, Express-compatible middleware, and `context.run`.
- Per-destination outbound context headers with Node HTTP header validation. A destination named `default` is used when `getHeaders()` is called without a name; without declared destinations, it contains every entry with a header. Passing an array of destination names combines their headers.
- `service.createFetch(destination?)`: Node's native `fetch` with the destination's context headers added to every call.
- Readiness and liveness probes.
- Graceful shutdown with `onShutdownStart`, connection draining, ordered cleanups, and a deadline.
- Fatal-error handling and a single coordinated process exit with a best-effort logger flush.
