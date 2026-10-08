# Changelog

All notable changes to this project will be documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `ContainerInfo.created` (unix seconds), filled by `DockerClient.listContainers()`.
- `DockerClient.findNetwork()` / `findVolume()` (null only on 404, other errors rethrown) and
  `NetworkManager.ensure()` (returns `{ id, created }`).

### Added

- `LocalNet.listPartiesWithFailures()` and `LocalNet.listPackagesWithFailures()` return the
  reachable results together with per-validator failures instead of calling `onWarning`.
- `readDarMainPackageId()` is exported from the API barrel.
- Discovery `GET /instances/:id/packages` returns 503 when no participant responds and a `failures`
  list alongside the reachable packages on partial results.

### Changed

- `LocalNet.state()` and `isRunning()` compare against the instance's expected container names: a
  missing container now makes the state `'partial'` (previously `'running'` if all existing ones
  ran).
- `start()` (and `dnm start`) now repairs a partially running instance instead of returning early:
  it starts stopped containers, creates missing ones, restarts running dependents of anything it
  started (nginx and the web UIs after splice) and re-runs initialization. It refuses paused
  containers and aborts on a 409 or a `created` container under 60 s old (another process is
  probably starting the instance; best-effort, it cannot see a start in its health-wait phase). A
  failed repair stops only containers it started and starts back dependents it had stopped. nginx
  now depends on the web UIs and starts in its own layer.
- **Breaking:** `ApiPartyInfo.isLocal` is removed (also from `dnm parties --json`, the discovery
  `/parties` response and `getSnapshot().parties`; the `dnm parties` table loses its Local column).
- **Breaking:** `getParties(name)` returns only parties hosted on `name` (the DSO party appears only
  under `sv`) and throws on an unknown name or a failed query. `getParties()` throws when no
  participant responds and warns, naming the validator, on partial failure.
- **Breaking:** `ApiPackageInfo` is now `{ packageId, validators }` (one row per package) and
  `CantonClient.listPackages()` returns `string[]`; `PackageDetails` is removed. `dnm packages`
  renders a matrix with one column per participant. `getPackages()` throws when no participant
  responds.
- **Breaking:** `getUsersWithRights(name)` throws on an unknown name (previously `[]`); unnamed, it
  warns per failed validator and throws if none responds. A failed rights query warns and lists the
  user with `rights: []`.
- `PartyDetails.isLocal` is optional (absent on the wire means not hosted here).
- Discovery `GET /instances/:id/parties` returns 503 when no participant responds and a `failures`
  list alongside the reachable parties on partial results.
- Added `LocalNetOptions.onWarning` and the `LocalNetWarning` type; the CLI prints warnings to
  stderr so `--json` output stays clean.

### Fixed

- `initializeResources()` (and so `dnm init` and a repairing `start()`) skips configured parties
  whose hint is already hosted on the validator, instead of re-allocating them and logging failures;
  its docstring no longer claims re-running creates duplicate users.
- `initializeResources()`, `dnm init`, and a `start()` that runs init now fail instead of
  re-allocating blindly when the hosted-party query fails for a validator with configured parties.
- A failed `start()` (and therefore `restart()` and `dnm start`) no longer destroys an existing
  instance. It removes only the containers, network and postgres volume that the failing call
  created, and stops again any pre-existing containers it had started. A failed first start still
  leaves nothing behind; a failed resume (for example a timeout) keeps the stopped containers, the
  network and the data volume. The progress message is now "Startup failed; removing resources
  created by this attempt...". `restart()` whose start step fails leaves the instance stopped.
- `getParties()` listed every party once per participant (18 rows for 6 parties); it now lists each
  party once, under the validator whose participant hosts it, with the host's display name.
- `createUser` bound hints to parties hosted on other validators; hints now resolve against the
  user's own validator, and a hint hosted only elsewhere is allocated on it (a different party id).
- `CantonClient.listParties()` ignored pagination; it now follows `nextPageToken`.
- `getUsersWithRights()` and `getSnapshot()` silently omitted validators that failed to respond;
  they now return the reachable results and warn for each failed validator.
- `uploadDar()` sent a multipart body Canton rejects, returned an empty package id, and silently
  skipped unknown validators; it now sends a raw octet-stream body, returns the main package id
  computed from the DAR, and throws on an unknown validator, an empty target list or an invalid DAR.
- `getPackages()` and `listPackages()` always returned an empty list.

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
