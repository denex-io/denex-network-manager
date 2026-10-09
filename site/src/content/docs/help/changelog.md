---
title: Changelog
description: Release history for denex-network-manager, and where to find the authoritative changelog.
---

The authoritative changelog lives in the repository so it ships with the source and the npm package:

- [`CHANGELOG.md`](https://github.com/denex-io/denex-network-manager/blob/main/CHANGELOG.md) — full
  history, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- [GitHub releases](https://github.com/denex-io/denex-network-manager/releases) — downloadable CLI
  binaries and `SHA256SUMS` per release

This page summarizes what each release means for you. It is not a copy of the changelog.

## Unreleased

Changes on `main` since 0.1.0-beta.1. They are not in a published release yet.

Behavior you can now rely on:

- `packages` DARs are uploaded at the end of initialization, by `dnm start` and `dnm init`, to each
  package's `uploadTo` participants (default `sv` and every validator). A failed upload is a
  warning; a missing DAR fails a fresh start before anything is created, and on resume, repair or
  `dnm init` it is a warning.
- A failed `start()` or `dnm start` no longer destroys an existing instance. It removes only what
  that attempt created, so a failed resume keeps the containers, the network, and the data volume.
- `start()` and `dnm start` repair a partially running instance: they start stopped containers,
  create missing ones, restart dependents such as Nginx, and run initialization again, which skips
  parties that already exist.
- `dnm credentials` and `getCredentials()` report the working wallet login,
  the validator name with hyphens replaced by underscores, followed by `-wallet-admin` (for example
  `validator_1-wallet-admin`), and `dnm credentials` shows the configured Keycloak admin.
- `getParties()` lists each party once, under its hosting validator. `getPackages()`,
  `uploadDar()`, `net.logs()` and `net.exec()` work as documented.
- Unknown config keys produce a warning instead of being dropped silently.
- `dnm status`, `env`, `credentials`, `stop`, `parties`, `packages` and `entitlements` find an
  instance that is not fully running when you omit `--instance`.
- The sequencer, mediator, Scan admin and SV admin ports inside the containers follow `basePort`,
  which removes port collisions at some `basePort` values.

Breaking changes to check before upgrading:

- Validator names and user IDs must be lowercase. Validator names must also be unique, must not be
  `sv`, and must not map to another validator's Keycloak realm.
- The 10-validator cap is gone; a config is rejected instead when its highest port exceeds 65535.
- The `LocalNet` constructor validates its config and throws `ZodError`, and `getConfig()` returns
  the normalized copy.
- `ApiPartyInfo.isLocal` is removed. `getParties(name)` returns only the parties hosted on `name` and
  throws for an unknown name, and the unnamed `getParties()` and `getPackages()` throw when no
  participant responds.
- `ApiPackageInfo` is now `{ packageId, validators }`, one row per package.
- `getUsersWithRights(name)` throws for an unknown name.
- The `validator` field on `parties` and `users` entries is removed; the key now warns and is
  ignored.
- `SV_INTERNAL_PORTS` is no longer exported.

An instance created by 0.1.0-beta.1 with a non-default `basePort` may fail to start, route web UI and API requests (502 through Nginx), or process transactions
after one of its canton, splice or nginx containers is recreated, because state written at creation still names the old ports. Destroy it and
start again. Instances at `basePort` 5000 are unaffected.

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
