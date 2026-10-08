# Changelog

All notable changes to this project will be documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- `LocalNet.logs()` no longer throws for `follow: false` (the default), and both `logs()` and
  `exec()` no longer return Docker's 8-byte stream frame headers mixed into the text. Output is now
  demultiplexed; stdout and stderr are merged in arrival order. Cancelling a followed log stream now
  closes the connection.
- `LocalNet.logs()` and `exec()` now work on any handle of a running instance, including ones
  attached implicitly. They take the full runtime container name (for example `default-splice`),
  look it up by the instance label on each call, and list the instance's container names when it is
  not found.

### Changed

- `LocalNet.exec()` and `DockerClient.execInContainer()` now also return separate `stdout` and
  `stderr` strings alongside `output`. The exit code is read after a short retry until Docker
  records it, and output truncated mid-frame is reported as an error. The new `ExecResult` type
  (`exitCode`, `output`, `stdout`, `stderr`) is exported from the package root.

## [0.1.0-beta.1] — 2026-07-28

Initial public beta release of `@denex/network-manager`.

### Distribution

- The npm package `@denex/network-manager` contains the **SDK only**. Install it with
  `npm install @denex/network-manager@beta`.
- The `dnm` CLI is distributed as a pre-compiled binary on the GitHub release. Install it with the
  `install.sh` script (see the README) or download the archive for your platform directly.
  Supported: Linux x64/arm64, macOS x64/arm64, Windows x64.
- Release archives are published with a `SHA256SUMS` file; `install.sh` verifies the checksum before
  installing.

### Fixed

- Fixed `dnm start` failing at the Scan readiness check on any non-default `basePort`. The Scan and
  SV Admin container ports were derived from `basePort`, but the Splice process always binds fixed
  internal ports, so the published mapping pointed at ports nothing was listening on.
- Corrected a stop/destroy timeout unit mismatch that caused Docker to reject the request with HTTP
  500 (`strconv.Atoi: invalid syntax`).
- Container configuration is now delivered via environment variables instead of bind mounts, and
  containers are cleaned up when startup fails partway through.
- Validator names are now length-limited, and colliding Keycloak users are de-duplicated.
- Super Validator host ports are `basePort`-relative, so multiple instances can run concurrently.
- Fixed the npm package build, which previously failed type-checking under `dnt`.
