# dsh-monitor-pro

[![CI](https://github.com/nexmoe/dsh-monitor-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/nexmoe/dsh-monitor-pro/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/nexmoe/dsh-monitor-pro)](https://github.com/nexmoe/dsh-monitor-pro/releases/latest)
[![License](https://img.shields.io/github/license/nexmoe/dsh-monitor-pro)](LICENSE)

Live host resource monitoring for **DeepSeek Harness**, adapted from [VS Code Monitor Pro](https://github.com/nexmoe/vscode-monitor-pro). Open **Monitor Pro** in the sidebar to view resource readings, or let an Agent read the same cached snapshot.

[简体中文](README.md) · [Releases](https://github.com/nexmoe/dsh-monitor-pro/releases/latest) · [Feature comparison (Chinese)](docs/COMPARISON.md) · [Changelog](CHANGELOG.md)

Package: `@nexmoe/dsh-monitor-pro` · Version: `0.1.2` · License: Apache-2.0.

Readings describe the machine running **Harness Host**. A remote browser may be running on a different machine.

## Features

- Native React main panel and sidebar entry, responsive layout and Harness theme integration.
- Ten resource groups: CPU, memory, network, disk I/O, disk capacity, battery, CPU frequency, temperature, GPU and power.
- Per-core CPU usage; used/active/available memory and swap; per-GPU utilization history with temperature and VRAM readings.
- Bounded history, gaps for unavailable measurements, signed battery power and a zero reference line.
- Card ordering and visibility, binary/decimal capacity units, byte/bit network units and decimal precision.
- Pause/resume display, collection status and errors, sample time, JSON export of the snapshot, displayed history and configuration.
- Shared Host Worker and cache; optional `monitor_snapshot` Agent tool.
- English, Simplified Chinese, Traditional Chinese and Japanese.

The VS Code status bar, line/bar view switching, per-core temperatures, separate GPU temperature/VRAM history and native backend installation/process management have not been ported.

## Install

Requires **Node.js 22+**. Runtime APIs and HTTP integration have been verified with **DeepSeek Harness 0.2.0-rc.2**. Other versions must provide compatible Cordis bundle, Client ModuleLoader, layout/sidebar and Locale APIs.

1. Download `nexmoe-dsh-monitor-pro-0.1.2.tgz` from [GitHub Releases](https://github.com/nexmoe/dsh-monitor-pro/releases/latest).
2. Open Harness **Plugins → Install plugin** and enter the downloaded file's **absolute path**.
3. Open **Monitor Pro** in the sidebar. The first sample may take a few seconds.
4. When replacing an installed version, **fully quit and restart Harness** to load the new Host and Client modules.

For remote deployments, the package must exist on the Host machine. Select the official npm registry if a configured mirror fails. This package is distributed through GitHub Releases and has not been published to npm; installing by package name alone will not retrieve this release.

If `plugin_manager` is available, use `install_bundle` with the archive's absolute Host path. Remove the bundle in the plugin manager to uninstall; Worker, timers, routes, tools and Client registrations are disposed with it.

## Configuration

Edit Monitor Pro's Host plugin configuration. Reloading configuration starts a new shared collector and resets history.

| Field | Default | Meaning |
| --- | --- | --- |
| `intervalMs` | `2000` | Integer sampling interval, 1000–60000 ms |
| `historySize` | `60` | Integer history capacity, 10–600 samples |
| `metrics` | All | Enabled metric IDs; an empty list disables metric collection |
| `source` | `systeminformation` | `systeminformation`, `mactop` or `go` |
| `backendUrl` | `http://127.0.0.1:8888` | Running native backend's HTTP origin; loopback only |
| `networkInterface` | `""` | SI interface name; empty sums active non-loopback interfaces |
| `diskMounts` | `[]` | Mount selection; empty uses deduplicated automatic selection |

Metric IDs:

```text
cpu memory network diskIO diskSpace battery cpuSpeed cpuTemp gpu power
```

```yaml
intervalMs: 2000
historySize: 120
source: systeminformation
metrics: [cpu, memory, network]
networkInterface: en0
diskMounts: []
```

Host settings affect all windows. Display preferences are browser-local. Hiding a card or pausing display does **not** stop Host collection. The Host continues sampling when the panel is closed; disable the plugin to stop it.

## Data sources

| Reading | systeminformation (default) | mactop | Original Go backend |
| --- | --- | --- | --- |
| CPU / memory | Supported; per-core CPU | Supported; active memory uses used memory | Supported; no per-core CPU |
| Network / disk I/O | Active interface sum / SI aggregate | Backend rates | First eligible interface / disk |
| Disk capacity / battery | SI | Supplemented by SI | Go |
| CPU frequency | When supported | Unavailable | When supported |
| Temperature | SI CPU temperature | SoC temperature | Backend sensors |
| GPU | NVIDIA via nvidia-smi | Apple Silicon utilization/temperature, no VRAM | Unavailable |
| Power | Unavailable | Total SoC power | Signed battery net power |

The default source needs no extra service. Apple Silicon GPU and SoC power require an externally running [mactop](https://github.com/metaspartan/mactop) Prometheus service: set `source: mactop` and its origin as `backendUrl`; the plugin reads `/metrics`. The Go source requires an externally running [original Go HTTP backend](https://github.com/nexmoe/vscode-monitor-pro/tree/main/go-backend), queried at `/api/v1/all`. Native executables are not bundled, installed or managed.

Explicit native sources do not silently switch after failures. The last successful sample and its timestamp remain visible with an error. SI dimension failures produce nullable readings and a partial failure status. Unsupported values display `—`. The first Go rate and rates following counter resets remain unavailable until a valid delta exists.

VPN, tunnel and bridge interfaces can cause duplicate traffic accounting in SI aggregates; select an interface for a specific egress. Disk deduplication uses the upstream device/APFS-container heuristic after explicit mount selection. AMD/Intel GPU usage is not supported. Apple Silicon shared memory is not presented as dedicated VRAM. SoC or battery power is not whole-machine wall power.

## Agent tool

When Harness provides its tools service, `monitor_snapshot` is registered with no arguments. It reads the shared cached host sample, source, timestamps, status and errors without triggering collection. History is omitted. The panel also works without the tools service.

## Build and test

From the repository root:

```sh
git clone https://github.com/nexmoe/dsh-monitor-pro.git
cd dsh-monitor-pro
corepack enable
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm check
pnpm smoke
pnpm pack --pack-destination artifacts
```

The project pins pnpm 11.7.0; install it separately if Corepack is unavailable. Pure upstream modules are vendored in [src/upstream](src/upstream), so builds require no parent VS Code checkout. Release archives contain compiled artifacts and need no TypeScript toolchain or install-time build scripts. Build before installing a local source directory.

`pnpm check` builds Host, Worker and Client, performs strict type checking, and runs collection/failure/lifecycle tests and a React/jsdom Client integration test. `pnpm smoke` collects two real systeminformation samples. CI covers Node.js 22 and 24.

An optional installed-Harness integration test exercises real Cordis, HTTP routing, signed-cookie authentication, samples, validation and route disposal on an isolated temporary server. It is skipped unless `DSH_RUNTIME_ROOT` is set. For a macOS desktop installation:

```sh
DSH_RUNTIME_ROOT='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules' \
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  --expose-internals --test test/runtime-http.test.mjs
```

Complete browser interaction, Windows/Linux collection and actual mactop/Go/NVIDIA hardware still require validation in those environments. The HTTP 405 from version 0.1.0 was fixed in 0.1.1 and remains fixed in this release; upgrade and fully restart Harness if it occurs.

## Architecture and releases

One Host Worker per plugin instance performs serial collection with a 15-second deadline. MonitorService shares a bounded cache. The authenticated `/api/monitor-pro/snapshot` route serves Client snapshots and generation-aware history deltas; `monitor_snapshot` reads the same cache for Agents. Configuration reloads reset the generation to prevent mixing data from different collectors.

Push a `v*` tag matching the package version to run the [release workflow](.github/workflows/release.yml). It validates the build, packs an installable `.tgz`, creates `SHA256SUMS` and uploads both to a GitHub Release. It does not publish to npm.

## License and attribution

[Apache-2.0](LICENSE), derived from [nexmoe/vscode-monitor-pro](https://github.com/nexmoe/vscode-monitor-pro) at `36b8f7487d2b6d3b9d6b210e372c18cb824eb25d`. Vendored algorithms retain provenance headers; [NOTICE](NOTICE) records adaptations. Runtime dependencies retain their respective licenses.
