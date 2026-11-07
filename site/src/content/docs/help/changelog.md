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

Changes on `main` since 0.1.0-beta.2. They are not in a published release yet.

Behavior you can now rely on:

- A LocalNet with the SV and 2 validators uses about 3.2 GB of Docker memory, down from about
  5.1 GB, and opens 175 Postgres connections instead of 475.
- Scan and SV app calls through `scan.localhost` and `sv.localhost` are no longer limited to 10
  requests/s for all callers together; the 429s are gone.
- Validator participants accept up to 256 in-flight commands, so parallel test suites are no longer
  rejected past 30.
- External parties onboarded with their keys in the party-to-participant mapping get validator
  wallet automation.
- The `CanActAsAnyParty` user right, on Splice 0.9.0 and later.

Breaking changes to check before upgrading:

- canton and splice log at INFO instead of DEBUG, so `dnm` logs carry about a tenth of the output.
  Daml `debug` statements still appear.
- New LocalNets run PostgreSQL 18 instead of 14 (14 reaches end of life on November 12, 2026).
  With `spliceVersion: '0.6.6'` the nodes log that they expect Postgres 14 to 17; they still run.
- Existing instances get these changes only by being destroyed and started again.

- New LocalNets run Splice 0.9.4 (Canton 3.6.4) instead of 0.6.6. Set `spliceVersion: '0.6.6'` in
  a new instance's config to keep the previous release, which is no longer the tested one.
- An instance created without `spliceVersion` keeps its containers when you start it again, but do
  not add `spliceVersion` to its config, not even `'0.6.6'`: `dnm start` then reports a config
  mismatch. A repair would create any missing container at 0.9.4 next to the old ones, so to move
  the instance to 0.9.4, destroy it (its ledger state is lost) and start it again.

## 0.1.0-beta.2 — 2026-10-29

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
- `spliceVersion` in the config runs a different Splice release than the bundled one. See
  [Splice version](/denex-network-manager/reference/configuration/#splice-version).
- Web UI containers from newer Splice images (Alpine 3.21+) become healthy; their health check no
  longer goes to `localhost`, which resolved to IPv6.

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
