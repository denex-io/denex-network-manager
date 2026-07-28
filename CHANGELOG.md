# Changelog

All notable changes to this project will be documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
