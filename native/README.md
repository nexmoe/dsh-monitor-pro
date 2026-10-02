# Native monitoring backend

The Go sources and tests in this directory are copied verbatim from
[nexmoe/vscode-monitor-pro](https://github.com/nexmoe/vscode-monitor-pro). Keep
upstream source changes separate from the build and packaging integration.
The backend uses Go 1.26.2 and serves its HTTP API on a loopback port chosen by
the plugin launcher.

## Build

Run from the project root with Go 1.26.2 on `PATH`:

```sh
node scripts/build-native.mjs
```

The default build produces both supported Windows binaries:

- `native/bin/win32-x64/monitor.exe` (`GOOS=windows`, `GOARCH=amd64`)
- `native/bin/win32-arm64/monitor.exe` (`GOOS=windows`, `GOARCH=arm64`)

Each compiler process is awaited. Builds use `CGO_ENABLED=0`, `-mod=readonly`,
`-trimpath`, and `-ldflags='-s -w'`. The script fails on a compiler error or a
missing, empty, or inaccessible expected executable. `GOTOOLCHAIN=local`
prevents an implicit toolchain download; install/select Go 1.26.2 explicitly.

Set `GO` to an executable path to use a project-local toolchain. The value is
an executable, not a command with arguments; paths containing spaces work.
Relative paths are resolved from the invoking working directory before the
compiler runs in `native/`:

```sh
GO="$PWD/.tools/go/bin/go" node scripts/build-native.mjs
```

In PowerShell:

```powershell
$env:GO = Join-Path $PWD '.tools/go/bin/go.exe'
node scripts/build-native.mjs
```

Use `--host` to add a local integration-test executable to the Windows builds:

```sh
GO="$PWD/.tools/go/bin/go" node scripts/build-native.mjs --host
```

On an Apple Silicon Mac this adds `native/bin/darwin-arm64/monitor`. Host
builds support x64/ARM64 on Windows, macOS, Linux, and FreeBSD; they are local
test artifacts. Only the two Windows directories belong in the package file
allowlist. A Windows host already matches one default target and is built
once. No global Go installation or mactop installation is required.

## Verification

Run the unmodified upstream tests from this directory:

```sh
GOTOOLCHAIN=local ../.tools/go/bin/go test -count=1 -timeout=3m ./...
GOTOOLCHAIN=local ../.tools/go/bin/go test -race -count=1 -timeout=3m ./...
```

Use `CGO_ENABLED=0` for a separate test of the production build configuration.
The race detector requires a supported host and C compiler; the Darwin ARM64
and Linux x64 checks use it with cgo enabled for the test executable only.
Distributable executables always disable cgo.

The CI and release workflows select Go 1.26.2 before native builds and package
creation. Both workflows run the Go tests and launch the actual Windows
executable, requesting `/health`, `/api/v1/basic`, `/api/v1/cpu`,
`/api/v1/memory`, `/api/v1/disk`, `/api/v1/network`, `/api/v1/host`,
`/api/v1/battery`, and `/api/v1/all`. They check successful JSON responses,
nonzero host memory, and the Windows host identity. Processes are stopped in a
`finally` block.

Windows x64 runs on `windows-latest`; Windows ARM64 runs on
`windows-11-arm`. This repository is public, so the Windows ARM64 hosted
runner is eligible. Actual availability and runtime results must be confirmed
by the workflow run. If the repository becomes private or that runner is
unavailable, retain the x64 runtime check and both cross-builds, remove the
unavailable ARM64 matrix entry, and explicitly document that ARM64 runtime
coverage is missing. A successful cross-build alone does not verify Windows
API behavior.

The Linux packaging job runs Go tests with the race detector, builds both
Windows binaries, runs the JavaScript checks, and packs the npm archive. It
then verifies that the archive includes both binaries, this README, the native
third-party notices, and every license file. Release publication depends on
both Windows runtime jobs and successful archive validation.

## Package integration

The package maintainer must update `package.json`; native binaries are ignored
build outputs and must be generated before packing. Add these entries to the
existing `files` allowlist:

```json
[
  "native/bin/win32-x64",
  "native/bin/win32-arm64",
  "native/README.md",
  "native/THIRD_PARTY_NOTICES.txt",
  "native/LICENSES"
]
```

The package exposes `build:native` for `node scripts/build-native.mjs`; the
JavaScript `build` stays separate. For a local package, build both sets of
artifacts explicitly before packing:

```sh
GO="$PWD/.tools/go/bin/go" pnpm build:native
pnpm build
pnpm pack --pack-destination artifacts
```

The `prepack` artifact verifier fails if required JavaScript or Windows native
artifacts are absent or empty, rather than silently packing an incomplete
plugin. Both workflows explicitly invoke the native script before checks and
packing. The existing `check` command builds and validates JavaScript; use
`build:native` separately to validate native compilation. Do not include the
whole `native/bin` directory: a developer's `--host` artifact must not enter a
Windows release.

## Third-party licenses

`THIRD_PARTY_NOTICES.txt` inventories distatus/battery, gopsutil, all indirect
production modules, additional resolved module-graph entries, and the Go
runtime/standard library. Original license and patent texts are retained in
`LICENSES/`, including the Go code attribution inside gopsutil and plist, and
Go-origin code used by purego. All native licenses must ship alongside the
Windows binaries.

When dependencies or Go versions change, compare `go list -m all` and
`go list -deps` for both Windows architectures and any additional shipped
platforms. Copy new upstream license/notice files verbatim, preserve copyright
notices, and update the inventory before packaging.
