# Changelog

## [0.1.6] — 2026-10-02

### Changed

- Display settings keep each metric on one row. Labels no longer wrap, and chart, color, digits and order controls stay aligned.

## [0.1.5] — 2026-10-02

### Changed

- Metric rows are compact bordered cards in a two-column grid. Charts and per-core meters stay inside the card instead of stretching across the page.

## [0.1.4] — 2026-10-02

### Fixed

- Managed mactop 2.x now receives a `:port` Prometheus address. Passing `127.0.0.1:port` made ListenAndServe fail with "too many colons" and the panel reported a startup timeout. mactop still binds that port to loopback.
- The panel uses the same page heading, pill filters, search field and grouped rows as the Harness task and plugin pages.

## [0.1.3] — 2026-10-02

### Added

- Automatic source selection: bundled Go on Windows, managed mactop on Apple Silicon, and systeminformation elsewhere.
- Managed start, stop, retry and failure reporting for the bundled Go collector and mactop, including a Homebrew install action.
- Seventeen Monitor Pro cards, including split throughput, battery power, GPU temperature and VRAM, OS information and uptime.
- Line, bar and per-core display modes, significant digits, unit spacing, compact units and uptime templates.

### Changed

- Managed mactop now binds directly to 127.0.0.1. A configured backendUrl remains an explicit advanced loopback override.
- Native startup failures stay on the selected source instead of silently falling back.
- Windows x64 and ARM64 Go binaries, their licenses and notices are included in the release package.

### Fixed

- Each card now formats and colors its own metric instead of inheriting the last rendered card.
- Managed mactop 2.x now receives a `:port` Prometheus address. Passing `127.0.0.1:port` made ListenAndServe fail with "too many colons" and the panel reported a startup timeout. mactop still binds that port to loopback.

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
