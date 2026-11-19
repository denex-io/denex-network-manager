# Changelog

All notable changes to this project will be documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Splice 0.10.2 support. `spliceVersion: '0.10.2'` generates the Splice 0.10 config shape: each
  Splice app's participant Admin API client is a `client-config` plus an `auth-config`, which 0.10
  requires. The tested releases are 0.9.4 and 0.10.2.
- Typed errors: `LocalNetError` (base), `InstanceMismatchError`, `SpliceVersionConflictError`,
  `ContainerStartupError`, `StartupTimeoutError` and `InitializationError`, exported from the
  package root and `/sdk`, so callers can tell these failures apart with `instanceof`.
- Image pulls report progress: `Pulling <image>...`, then the elapsed time every 10 seconds, then
  `Pulled <image> (<n>s)`. A cold start used to print nothing for minutes during the splice-app
  pull.
- A `spliceVersion` outside the tested set (0.9.4, 0.10.2) is accepted with a warning that it is
  untested and which config shape (0.9 or 0.10) it gets; a tag that is not a release number, such as
  `dev-snapshot`, gets the 0.10 shape. Only a value that cannot be a Docker tag is refused, as
  before.
- `install.sh` reads `DNM_BASE_URL`: the URL of a directory holding the release archives and
  `SHA256SUMS` (for example `file:///tmp/dist` or a mirror), used instead of the GitHub release. CI
  uses it to install the archives it has just built.
- Release checks: a release runs the full integration suite on Splice 0.9.4 and 0.10.2 before
  anything is published or the `latest` dist-tag moves, and installs each binary a hosted runner can
  execute (linux-x64, linux-arm64, darwin-arm64 through `install.sh`; win-x64 from its zip), which
  must report the release version. The tag must be on `main` and equal the `deno.json` version. Pull
  requests also check formatting, the frozen lockfile and `install.sh` (shellcheck, and an install
  in a clean `ubuntu:24.04` container), with Deno pinned to 2.9.3.
- A config `version` other than `'1.0'` is read with a warning naming it; before, it was accepted
  without one.
- `LocalNetWarning.source` can be `'instance'`: an existing instance resumes as it was created
  although it differs from the current config and options (for example another image).

### Changed

- **Breaking:** `start()` refuses a repair that would create missing containers next to existing
  ones running other images (for example after a dnm upgrade changed a default, or after
  `options.images` changed). It throws `InstanceMismatchError` before changing anything; destroy the
  instance, or start it with the `spliceVersion` and images it was created with. Before, the repair
  mixed releases. A complete instance still resumes as it was created, with an `'instance'` warning.
  A config mismatch on start now throws `InstanceMismatchError` too (still an `Error`).
- **Breaking:** `LocalNetOptions.images` that put canton or splice-app on a Splice release whose
  config shape differs from the config's release (0.10.x vs earlier) throw
  `SpliceVersionConflictError` when the handle is created. Set `spliceVersion` to that release.
  Same-shape overrides (for example 0.7.0 images with the 0.9.4 default) are unchanged.
- A container that stops, turns unhealthy or never becomes healthy during `start()` fails it with
  `ContainerStartupError`, which carries the container's last 20 log lines. They are read before the
  failed start is rolled back; before, the rollback removed the container and its logs, and the
  message said only "stopped unexpectedly" or "is unhealthy", which it still starts with.
- **Breaking:** `--timeout` (`StartOptions.timeout`) is now enforced as a wall-clock limit on the
  whole start, image pulls included; previously it was only checked between container layers, so the
  last health wait and initialization's waits for the validator APIs and Scan ran past it. Running
  out throws `StartupTimeoutError` (phase `pull`, `start` or `init`; before, a plain `Error`
  "Startup timeout exceeded"), or `ContainerStartupError` with the logs during a health wait. An
  explicit timeout now bounds the whole start; raise it if you set one below a cold start. The
  default rises from 300000 to 600000 ms: a cold start in a fresh container (linux-arm64, every
  image pulled) took 290.7 s, and 600 s is 2× that, rounded up to a whole minute.
- **Breaking:** a configured party or user that initialization cannot set up fails `start()` with
  `InitializationError` (`kind` `'party'` or `'user'`, the hint or user id, its validator, and the
  cause), so `dnm start` and `dnm init` exit 1 naming it; before, it printed
  `Warning: Failed to
  allocate party …` or `Warning: Failed to create user …` and `start()`
  succeeded without it. A failed fresh start is rolled back and a failed resume removes nothing, as
  for any startup failure. A party or user that already exists still counts as set up, and package
  uploads still only warn. A validator's API (or Scan, for `sv`) that does not become ready within
  its 30 attempts and the hosted-party query failure (`Cannot check existing parties on …`) are an
  `InitializationError` too (`kind: 'validator'`, the last error as `cause`; before, a plain
  `Error`).
- `createUser()` creates the Canton user only when looking it up returns 404. Any other lookup error
  fails it with a `LocalNetError` carrying the cause; before, every lookup error led to a create
  attempt, and the lookup error was lost.
- Health waits follow Docker's own verdict: `start()` fails on the first `unhealthy` Docker reports
  (after the health check's start period and retries) instead of after its own poll count, polls
  every second instead of every 5–10, and prints the elapsed time and last health status every 10
  seconds.
- **Breaking:** config input refuses, with an error naming the field, what was only refused at
  startup before (by Keycloak or Canton, after the containers were up): a user id that is not 3 to
  128 characters of letters, digits and ``@^$.!`-#+'~_|:()`` (Keycloak usernames are at least 3
  characters, Canton 3.6/3.7 user ids at most 128 of these; before, any lowercase string), and a
  user's `primaryParty` or `parties[].hint` that Canton does not accept as a party hint (letters,
  digits, `:`, `-`, `_` and spaces, at most 185 characters, no `::` and no trailing `:`, which do
  not read back as the same hint; before, any non-empty string). Stored instance labels are not
  checked, so existing instances stay stoppable.
- The bundled default stays Splice 0.9.4. Splice 0.10 moves to Canton 3.7 and protocol version 37
  (per its release notes), where `GenerateExternalPartyTopology` returns v31 topology transactions
  unless the request pins protocol version 36, which changes external-party onboarding for SDK
  users.
- The SV app config no longer sets `comet-bft-config`. Splice 0.10.2 removed CometBFT; at 0.9.4
  leaving it unset is the same as the `enabled = false` dnm wrote.

### Fixed

- The `--skip-init` help now says it skips the readiness waits, so `dnm start --skip-init` can
  return before the APIs answer.

## [0.1.0-beta.3] — 2026-11-09

### Changed

- `npm install @denex/network-manager` without a tag installs the newest release: each release now
  also moves npm's `latest` dist-tag, which had stayed on 0.1.0-beta.1. The `beta` tag moves as
  before.
- **Breaking:** the bundled Splice release is 0.9.4 (Canton 3.6.4), up from 0.6.6 (Canton 3.5.1),
  for all six Splice-family images. Set `spliceVersion: '0.6.6'` in a new instance's config to keep
  the previous release, which is no longer the tested one.
- A LocalNet uses about 37% less memory: 3.2 GiB instead of 5.1 GiB for the SV and 2 validators at
  idle (measured on Docker Desktop with a 7.75 GB VM).
  - Canton and Splice storage pools are 8 connections instead of 32, so the SV and 2 validators open
    175 Postgres connections instead of 475.
  - The canton and splice containers run with `JAVA_TOOL_OPTIONS` that make G1 return unused heap to
    the OS. They set no heap cap.
  - Keycloak's heap is capped at 512 MB (`JAVA_OPTS_KC_HEAP`), down from 70% of the Docker VM.
  - canton and splice run no Prometheus metrics reporter (nothing read them). `basePort + 13` and
    `basePort + 64` stay reserved.
- **Breaking:** canton and splice log at INFO instead of the images' DEBUG default, about a tenth of
  the log output. Daml `debug` statements are raised to INFO, so they still appear.
- Validator participants accept Canton's default of 256 in-flight commands instead of 30. The SV
  participant keeps 30.
- Every validator app runs wallet automation for external parties whose signing keys are embedded in
  the party-to-participant mapping (`support-embedded-party-signing-keys = true`, the Splice 0.10
  default). Splice 0.6.6 ignores the setting.
- New Postgres data volumes are initialized with data checksums, which removes Splice's startup
  warnings.
- **Breaking:** the default PostgreSQL image is `postgres:18` instead of `postgres:14`, which
  reaches end of life on 2026-11-12. With 18 and later the data volume mounts at
  `/var/lib/postgresql`, because the 18 image refuses to start with a mount at
  `/var/lib/postgresql/data`. A `LocalNetOptions.images.postgres` tag naming a major below 18 keeps
  the old path. Splice 0.9.4 supports it (its Canton accepts Postgres 14 to 18). Splice 0.6.6 runs
  on it but logs that it expects 14 to 17, from Canton's version check and from Flyway; from the
  SDK, `images.postgres: 'postgres:17'` avoids the warnings. Recreate instances created by earlier
  versions (destroy, then start; their ledger state is lost).

### Added

- `CanActAsAnyParty` user right (Ledger API 3.6, so Splice 0.9.0 and later). A config whose
  `spliceVersion` is older and grants it is rejected: an older participant rejects the user's whole
  rights grant.

### Fixed

- Scan and SV app requests through nginx (`scan.localhost`, `sv.localhost`) no longer get HTTP 429
  beyond 10 requests/s. Splice's per-client-IP limit treated every request as one client, because
  nginx sets `X-Real-IP`; it is now off for both apps (Splice 0.7.5 and later). The 200 requests/s
  overall limit is unchanged.

### Removed

- The generated config no longer sets Canton's deprecated `initial-protocol-version` or Splice's
  removed `domain-migration-id`. Neither had an effect.

### Upgrade notes

- An instance created without `spliceVersion` keeps its containers when it is started again, but
  adding `spliceVersion` to its config, even `'0.6.6'`, makes `start()` fail the config-mismatch
  check, and a repair creates any missing container at 0.9.4 next to the old ones. To move such an
  instance to 0.9.4, destroy it (its ledger state is lost) and start again. From the SDK,
  `images: buildSpliceImages('0.6.6')` in `LocalNetOptions` keeps its repairs at 0.6.6, because
  options are not part of the compared config.
- The memory, logging, rate-limit and validator settings above reach an existing instance only
  through containers a repair recreates; starting it again keeps its containers as they are. They do
  not cause a config mismatch. Destroy and recreate an instance to get all of them.

## [0.1.0-beta.2] — 2026-10-29

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
- `spliceVersion` config field: runs the six Splice-family images (`canton`, `splice-app` and the
  four web UIs) at the given release tag instead of the bundled default. Explicit
  `LocalNetOptions.images` win. `LocalNetBuilder.withSpliceVersion()` sets it, and
  `buildSpliceImages(version)` returns the same image map.

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

- The web UI health checks target `127.0.0.1` instead of `localhost`. Alpine 3.21+ images resolve
  `localhost` to `::1` first while their nginx listens only on IPv4, so newer Splice web UI images
  never became healthy.
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
- `getCredentials()` and `dnm credentials` reported `validator-1` / `validator-1` as the wallet
  login, which Splice does not onboard. They now report the wallet-admin login
  (`validator_1-wallet-admin`), skip duplicate ids per realm, and mark YAML users without
  `primaryParty` as not onboarded. The generated `WALLET_ADMIN_USER_NAME` env variable had the same
  mismatch and now matches.
- `dnm credentials` printed a hardcoded `admin / admin` Keycloak login. It now shows the configured
  `auth.keycloak` login, and `--json` output gains a `master` entry for it.

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
