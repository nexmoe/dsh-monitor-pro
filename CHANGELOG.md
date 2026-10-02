# Changelog

## [0.1.16] — 2026-10-02

### Fixed

- The selected filter is styled from aria-selected with a selector that wins over the host button reset, using the same hover surface that is already visible.

## [0.1.15] — 2026-10-02

### Changed

- The live status label is hidden. A status chip appears only when collection fails, goes stale, or is partial.

## [0.1.14] — 2026-10-02

### Fixed

- The selected filter uses a visible tint. The previous surface token matched the page background, so the active chip looked unchanged.

## [0.1.13] — 2026-10-02

### Fixed

- Cards in the same row share one height. Extra disk volumes scroll inside the disk card instead of leaving a gap beside the row.

## [0.1.12] — 2026-10-02

### Changed

- The footer no longer repeats uptime and platform details that already appear on the system cards.

## [0.1.11] — 2026-10-02

### Fixed

- Metric cards flow in columns by their own height, so a short card is no longer paired with a tall empty gap. Disk volumes render in full.

## [0.1.10] — 2026-10-02

### Fixed

- Cards in a row keep their own height instead of stretching to the tallest neighbor. Long disk lists scroll inside the card.

## [0.1.9] — 2026-10-02

### Removed

- The pause view control. The panel always keeps polling while it is open.

## [0.1.8] — 2026-10-02

### Fixed

- The selected filter chip now has a filled background and medium-weight label, so the active choice is visible.

## [0.1.7] — 2026-10-02

### Changed

- Host, uptime, sample time, source, interval and history now appear in the page footer with the collector note.

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
