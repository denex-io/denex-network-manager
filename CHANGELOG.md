# Changelog

All notable changes to this project will be documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `packages:` auto-upload: each configured DAR is uploaded to its `uploadTo` participants (default
  `sv` and every validator) at the end of initialization, so by `dnm start` and again by `dnm init`.
  A failed upload or a missing DAR on resume warns (`source: 'packages'`) and start continues; a
  missing DAR on a fresh start fails before anything is created.
- `LocalNetOptions.configDir` and the `<labelPrefix>.config-dir` container label: the directory that
  relative `packages[].dar` paths resolve against (then the cwd). `fromConfig(path)` and `dnm start`
  set it to the config file's directory.
- `packages[].uploadTo` is checked on input: it must not be empty and may name only `sv` or a
  configured validator.
- `ContainerInfo.created` (unix seconds), filled by `DockerClient.listContainers()`.
- `DockerClient.findNetwork()` / `findVolume()` (null only on 404, other errors rethrown) and
  `NetworkManager.ensure()` (returns `{ id, created }`).
- `LocalNet.listPartiesWithFailures()` and `LocalNet.listPackagesWithFailures()` return the
  reachable results together with per-validator failures instead of calling `onWarning`.
- Discovery `GET /instances/:id/packages` returns 503 when no participant responds and a `failures`
  list alongside the reachable packages on partial results.
- `parseLocalNetConfigWithWarnings()`, `parseStoredLocalNetConfig()`, `ConfigWarning`,
  `LocalNet.warnings`, and an optional `{ onWarning }` argument on `parseLocalNetConfig`,
  `validateLocalNetConfig`, `withDefaults`, `loadConfigFile`, `loadConfigFromDir` and
  `loadConfigFromString`.

### Changed

- Existing configs with a `packages:` list now upload those DARs on `dnm start` (previously the
  field was parsed and ignored). The parsed config is unchanged (`dar` as written, no `uploadTo`
  default), so instances created by earlier versions still resume without a config mismatch;
  instances without a `config-dir` label resolve relative paths against the cwd.
- `dnm config -y` overwrites an existing file after copying it to `<file>.bak` (an existing
  `<file>.bak` is replaced); it used to prompt, and hung without a TTY.
- `dnm status`, `env` and `credentials` (running, then mixed, then stopped), `stop`, `parties`,
  `packages` and `entitlements` (running, then mixed) now auto-resolve an instance that is not fully
  running when `--instance` is omitted, and print a stderr notice when they fall back or ignore
  other instances. `stop` says "already stopped" for a stopped-only instance (still exit code 1).
- `DiscoveredInstance.status` (so `dnm instances` and `LocalNet.discover()`) no longer depends on
  the order Docker lists containers in: any disagreement between containers is `mixed`.
- `--verbose` on `dnm parties`, `packages` and `entitlements` is hidden (still accepted, no effect).
- CLI messages now name the real commands (`dnm discovery serve`, `dnm start --instance <id>`,
  `dnm start --config <path>`); `dnm instances` no longer says it lists only running instances.
- `LocalNet.state()` and `isRunning()` compare against the instance's expected container names: a
  missing container now makes the state `'partial'` (previously `'running'` if all existing ones
  ran).
- `start()` (and `dnm start`) now repairs a partially running instance instead of returning early:
  it starts stopped containers, creates missing ones, restarts running dependents of anything it
  started (nginx and the web UIs after splice) and re-runs initialization. It refuses paused
  containers and aborts on a 409 or a `created` container under 60 s old (another process is
  probably starting the instance; best-effort, it cannot see a start in its health-wait phase). A
  failed repair stops only containers it started and starts back dependents it had stopped. A
  container in Docker's restart backoff (nginx crash-looping after a daemon restart) is stopped and
  started again, since a plain start is a no-op. On a 409 the network and volume this call created
  are left in place too. Repair needs a handle that is not already attached (`fromInstanceId()`
  handles and handles that ran a state query throw "already running"). nginx now depends on the web
  UIs and starts in its own layer.
- `DockerClient.findContainer()` returns `null` only for a 404 and rethrows other inspect errors;
  `start()` uses it, so a transient inspect error aborts the start (and rolls back) instead of
  looking like a name conflict.
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
- **Breaking:** `uploadDar()` (and `CantonClient.uploadDar()` / `uploadDarFromFile()`) now returns
  `Promise<void>`; the package id was never populated before. Use `getPackages()` to see the result.
- `PartyDetails.isLocal` is optional (absent on the wire means not hosted here).
- Discovery `GET /instances/:id/parties` returns 503 when no participant responds and a `failures`
  list alongside the reachable parties on partial results.
- Added `LocalNetOptions.onWarning` and the `LocalNetWarning` type; the CLI prints warnings to
  stderr so `--json` output stays clean.
- Sequencer (public, admin, gRPC health), mediator (admin, gRPC health), Scan admin and SV admin
  ports now follow `basePort` inside the containers too (basePort+8/+9/+62, +7/+63, +12/+14; Scan
  and SV admin are published on the same number). Nothing changes at basePort 5000. Previously these
  were fixed at 5007-5014/5062-5063, so some `basePort` values (for example 4847 or 4947) made a
  participant port collide with the sequencer or mediator and the instance could not start.
- The splice and canton Prometheus metrics reporters now listen on basePort+13 (splice) and
  basePort+64 (canton) inside their containers instead of the image default 10013, at every
  `basePort` including 5000. The port is never published to the host and is not persisted, so
  nothing outside the container sees the change; it removes a collision at `basePort` values such as
  9010 (splice) or 9951 (canton).
- Unknown config keys now produce a warning (stderr in the CLI, `LocalNetOptions.onWarning` in the
  SDK) instead of being dropped silently; `LocalNet.warnings` holds the construction-time ones. The
  exported `LocalNetConfigSchema` still strips them. Stored instance labels are parsed silently and
  leniently.
- **Breaking:** the validator count no longer has a cap of 10 (config, `dnm config` prompt,
  `withValidators`); instead a config whose highest derived port exceeds 65535 is rejected, for
  example 55 validators at `basePort: 60000`.
- **Breaking:** validator names must be lowercase (Keycloak lowercases usernames, so a name such as
  `App` left the validator backend retrying `PERMISSION_DENIED` forever), unique, must not be `sv`,
  and must not map to the same Keycloak realm as another validator (`ab` and `ab-`). User ids must
  be lowercase for the same reason (`Alice` is rejected, use `alice`); this rule covers config input
  and runtime `LocalNet.createUser()`. Stored labels from older SDKs are not re-checked and still
  load; a stored user with an uppercase id is reported as a warning at startup instead of created.
  `withValidators(count)` throws `RangeError` for a non-integer or `< 1` count.
- **Breaking:** the `LocalNet` constructor (and so `createLocalNet`) validates its config and throws
  `ZodError`, applies schema defaults and reports warnings; `getConfig()` returns the normalized
  copy, not the object passed in. Existing instances remain discoverable, stoppable and destroyable;
  resuming from YAML requires the YAML to pass the new rules.
- `dnm config` validates the generated file (duplicate or colliding validator names) before writing.
- `LocalNet.exec()` and `DockerClient.execInContainer()` now also return separate `stdout` and
  `stderr` strings alongside `output`. The exit code is read after a short retry until Docker
  records it, and output truncated mid-frame is reported as an error. The new `ExecResult` type
  (`exitCode`, `output`, `stdout`, `stderr`) is exported from the package root.

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
  created by this attempt...". `restart()` whose start step fails leaves the instance stopped,
  unless it aborted on a 409 name conflict (another process starting it), which leaves the
  containers it started running.
- `getParties()` listed every party once per participant (18 rows for 6 parties); it now lists each
  party once, under the validator whose participant hosts it, with the host's display name.
- `createUser` bound hints to parties hosted on other validators; hints now resolve against the
  user's own validator, and a hint hosted only elsewhere is allocated on it (a different party id).
- `CantonClient.listParties()` ignored pagination; it now follows `nextPageToken`.
- `getUsersWithRights()` and `getSnapshot()` silently omitted validators that failed to respond;
  they now return the reachable results and warn for each failed validator.
- `uploadDar()` sent a multipart body Canton rejects, returned an empty package id, and silently
  skipped unknown validators; it now sends a raw octet-stream body and throws on an unknown
  validator or an empty target list; Canton's error for a rejected DAR is surfaced.
- `getPackages()` and `listPackages()` always returned an empty list.
- `LocalNet.logs()` no longer throws for `follow: false` (the default), and both `logs()` and
  `exec()` no longer return Docker's 8-byte stream frame headers mixed into the text. Output is now
  demultiplexed; stdout and stderr are merged in arrival order. Cancelling a followed log stream now
  closes the connection.
- `LocalNet.logs()` and `exec()` now work on any handle of a running instance, including ones
  attached implicitly. They take the full runtime container name (for example `default-splice`),
  look it up by the instance label on each call, and list the instance's container names when it is
  not found.

### Removed

- **Breaking:** `SV_INTERNAL_PORTS` is removed from the package root without a deprecation period.
  Its values were only correct at basePort 5000. The internal port helpers are not part of the
  public API. The SV-only port numbers are listed in the README "Port Allocation" section.
- **Breaking:** the never-used `validator` field on `PartyConfig` and `UserConfig` is removed; the
  keys now warn and are ignored.

### Upgrade notes

- Instances created by 0.1.0-beta.1 with a non-default `basePort` keep their original container
  configuration across stop/start. If such an instance's canton, splice or nginx container is
  recreated by this version (for example by repairing a partially running instance, or after
  removing a container), the new container uses the new ports while state written at creation still
  names the old ones: the mediator's sequencer connection, each participant's synchronizer
  connection, and the sequencer and Scan URLs the SV published to the DSO. The instance may then
  fail to start or process transactions; destroy it and start again. basePort-5000 instances are
  unaffected.

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
