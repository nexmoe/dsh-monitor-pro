# Changelog

## [Unreleased]

- Clarified that source builds require Node.js 22.13+ for pnpm 11; installed plugin runtime support remains Node.js 22+.

## [0.1.2] — 2026-10-02

### Added

- Standalone `nexmoe/dsh-monitor-pro` repository, Chinese and English documentation, and a detailed comparison with VS Code Monitor Pro.
- CI for build, strict type checking and tests; tagged-release automation with an installable `.tgz` and SHA-256 checksum.

### Changed

- Vendored pure upstream algorithms and snapshot types so source builds no longer depend on a parent VS Code repository.
- Updated package repository metadata and attribution for the standalone project.
- Preserved the 0.1.1 authenticated RPC fix and existing monitoring behavior.

## 0.1.1 — 2026-10-02

- Fixed HTTP 405 in the dashboard by using Connection's authenticated exact Fetch route at /api/monitor-pro/snapshot, avoiding the undeclared webServer scope in Harness 0.2.0-rc.2 custom RPC registration.
- Added an installed-Harness integration test covering Cordis activation, the real HTTP router, browser/Host RPC envelopes, live sampling, validation, authentication and route disposal.

## 0.1.0 — 2026-10-02

- Added the first DeepSeek Harness bundle with a native dashboard and sidebar entry.
- Added shared worker sampling, bounded history, deadline termination, generation-aware deltas and lifecycle cleanup.
- Added systeminformation, explicit loopback mactop and Go collectors; nullable unavailable measurements and source-specific power labels.
- Added per-core CPU, ten resource cards, chart history, preferences, pause/resume and JSON export.
- Added four synchronized locales, plugin metadata, host configuration and optional monitor_snapshot agent tool.
- Added failure-boundary tests, real-host smoke script, build/package scripts and installation documentation.
