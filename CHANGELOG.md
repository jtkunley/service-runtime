# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.1.0

First release published to npm, as `@jtkunley/service-runtime`.

### Added

- `service.createFetch(destination?)` returns Node's native `fetch`, adding the destination's current context headers to every call. Headers passed to a call take precedence.
- A destination named `default` is used when `createFetch()` or `getHeaders()` is called without a name. Without declared `destinations`, `default` contains every context entry that declares a header.
- `createFetch` and `getHeaders` accept an array of destination names and combine their headers.
- `GetHeadersArgs`, `KnownAttributes`, and `KnownEntries` types are exported.

### Changed

- The published types require TypeScript 5.4 or later.
- `ContextEntries` and `ContextDestinations` are no longer generic. Unknown entry attributes and unknown destination entries are still rejected at compile time.
- `context.get` and `context.getStore` are documented as rarely needed; prefer `createFetch` or `getHeaders`.

### Fixed

- Resolver parameters are typed correctly when `destinations` is written after `context` in the options.

## 1.0.1

Initial release, tagged on GitHub only.

- `configureService(options)` with synchronous validation and configuration snapshots.
- Scoped request context with typed entries, Express-compatible middleware, and `context.run`.
- Per-destination outbound context headers with Node HTTP header validation.
- Readiness and liveness probes.
- Graceful shutdown with `onShutdownStart`, connection draining, ordered cleanups, and a deadline.
- Fatal-error handling and a single coordinated process exit with a best-effort logger flush.
