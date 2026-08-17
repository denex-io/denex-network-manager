---
title: Changelog
description: Release history for denex-network-manager, and where to find the authoritative changelog.
---

The authoritative changelog lives in the repository so it ships with the source and the npm package:

- [`CHANGELOG.md`](https://github.com/denex-io/denex-network-manager/blob/main/CHANGELOG.md) — full
  history, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- [GitHub releases](https://github.com/denex-io/denex-network-manager/releases) — downloadable CLI
  binaries and `SHA256SUMS` per release

This page summarises what each release means for you. It is deliberately not a copy of the changelog.

## 0.1.0-beta.1 — 2026-07-28

The initial public beta.

**What you get.** The `@denex/network-manager` npm package (SDK only), and the `dnm` CLI as a
pre-compiled binary for Linux x64/arm64, macOS x64/arm64, and Windows x64, published on the GitHub
release with checksums that `install.sh` verifies before installing.

**If you were tracking pre-release builds,** this release fixed several things that would have
affected you:

- `dnm start` no longer fails the Scan readiness check on a non-default `basePort`
- `stop` and `destroy` no longer fail with an HTTP 500 from Docker on the timeout value
- Container configuration moved from bind mounts to environment variables, and a partway-failed
  startup now cleans up after itself
- Super Validator host ports became `basePort`-relative, which is what makes concurrent instances
  possible

**Stability expectations.** The SDK surface may still change within `0.x`. Pin an exact version if you
need stability, and read the changelog before upgrading.
