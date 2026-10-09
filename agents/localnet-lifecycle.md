# LocalNet Lifecycle

## Scope

- Covers: the `LocalNet` class, lifecycle methods, static factories, initialization, labels, cache,
  runtime user creation, package upload, logs, and exec.
- Read when: changing `src/localnet.ts` or behavior exposed through the SDK/CLI lifecycle.
- Excludes: detailed generated config syntax and low-level Dockerode wrappers.
- Supporting docs: `test/integration/localnet_test.ts` and
  `test/integration/initialization_test.ts`.

## What this subsystem is

`LocalNet` is the unified high-level object for starting, attaching to, querying, and destroying a
LocalNet. It owns config generation, Docker startup, API clients, state query aggregation, resource
initialization, and runtime operations.

## Main public surface

- Factories: `fromConfig()`, `fromInstanceId()`, `discover()`, `createLocalNet()`.
- Lifecycle: `start()`, `stop()`, `destroy()`, `restart()`, `status()`, `state()`, `isRunning()`.
- State: `getValidatorState()`, `getAllValidatorStates()`, `getParties()`, `getUsers()`,
  `getUsersWithRights()`, `getPackages()`, `getSnapshot()`, `getDsoPartyId()`, `getEndpoints()`,
  `getCredentials()`.
- Mutations: `allocateParty()`, `createUser()`, `initializeResources()`, `uploadDar()`.
- Utilities: `logs()`, `exec()`, `getConfig()`, `getOptions()`, `getContainerId()`,
  `getCantonClient()`, `getValidatorClient()`, `instanceId`, `currentState`.

## Working rules

- `fromConfig()` validates config objects through Zod; callers must still call `start()`.
- `createLocalNet()` constructs and starts immediately.
- `fromInstanceId()` reconstructs config from Docker labels and requires label schema `2`.
- `start()` calls `detectConfigMismatch()` and returns early only when every expected container
  (`buildContainerSpecs(...).map(name)`) is running. A partially running instance is repaired:
  stopped containers are started, missing ones created, and running containers whose `dependsOn`
  intersects the containers started or created by this call (`rb.touched`) are restarted (not
  recorded in `rb.started`, so rollback leaves them running). nginx depends on the web UIs, so it
  gets its own layer. A container in `restarting` state (nginx crash-looping after a daemon restart)
  is stopped and then started, because Docker answers a plain start with 304. Repair is not
  reachable on an attached handle (`fromInstanceId()`, or after `requireRunning()` attached):
  `start()` throws "already running" first.
- Rollback (`rollbackStart`) first starts again the dependents it stopped for a restart and whose
  start then failed (`rb.restarted`), then removes `rb.created`, then stops `rb.started` layer by
  layer. The order matters: nginx uses static `proxy_pass` hostnames with no `resolver`, and Docker
  DNS drops stopped containers, so an nginx started after its upstreams stop crash-loops with "host
  not found in upstream".
- Repair guards: a paused container is refused (`docker unpause` hint); a `created` container under
  60 s old (from list `ContainerInfo.created`) aborts with "appears to be starting in another
  process" before anything changes; an older `created` container is started normally. A 409 on
  create can happen mid-start; it sets `rb.conflict`, and rollback then removes only the containers
  this call created: it does not stop the containers this call started and does not remove the
  network or volume. `ensureStarted` looks containers up with the 404-aware `findContainer()`, so a
  transient inspect error is not mistaken for a missing container (and a 409). The concurrency guard
  is best-effort: it cannot see another process that is already in its health-wait phase.
- `start()` runs `initializeResources()` unless `skipInitialization` is set. Init is idempotent: the
  party loop pre-checks `fetchHostedParties()` and skips hints already hosted. If that query fails
  for a validator with configured parties, init throws "Cannot check existing parties on
  '<validator>'" instead of re-allocating blindly, so a transient query failure aborts init and
  rolls back a `start()`.
- State-query methods call `requireRunning()` and may attach lazily to running containers.

## Critical gotchas

- Config JSON is embedded in Docker labels and must stay under 100,000 bytes.
- The API cache TTL is 30 seconds; mutation methods invalidate relevant keys.
- `createUser()` is not atomic but is intentionally convergent: ledger user, Keycloak user, and
  wallet onboarding may partially succeed and retry cleanly.
- `destroy()` unconditionally removes named volumes (postgres data) and `.localnet/<instance>`
  config data. The `StopOptions` parameter is forwarded to the internal `stop()` call (for timeout
  control) but does not gate volume removal.
- `destroy()` uses the cwd captured at construction time (`instanceCwd`), not `process.cwd()` at
  call time — safe to call after a directory change.
- `validatePortAvailability()` checks Docker-published ports, not all host processes.
- `waitForApisReady()` retries before resource initialization.
- `StartOptions.timeout` and `StopOptions.timeout` are both in **milliseconds** at the public API.
  `stop()` converts internally to seconds for the Docker API. Default: `start()` 300,000 ms,
  `stop()` 30,000 ms.
- `start()` failure is non-destructive. A per-call `StartRollback` tracker records the network,
  volume and containers this call created and the pre-existing containers it started. On failure
  `rollbackStart()` force-removes only the created containers, stops the pre-existing ones it
  started (one layer at a time in reverse layer order, 30 s grace), and removes the network and
  `<id>-postgres-data` only if this call created them. A failed resume therefore keeps containers,
  network and data; a failed fresh start leaves nothing. State always returns to `'stopped'` (never
  `'error'`; only a failed `stop()` sets `'error'`). `restart()` whose start step fails leaves the
  instance stopped, except after a 409 (see above), which leaves the containers it started running.
- Each startup layer runs `ensureStarted` for all specs via `Promise.allSettled`, throws the first
  rejection, and only then runs `waitHealthy` for the layer, so rollback never races a sibling that
  is still mutating Docker. Network and volume absence is decided by 404-aware
  `DockerClient.findNetwork`/`findVolume` (any other error aborts); `getNetworkInfo`/`getVolumeInfo`
  keep returning null on any error and are public.
- `cleanupInstanceResources()` is destroy-only and removes everything labelled for the instance; do
  not call it from failure paths.
- `detectConfigMismatch()` returns `{ hasMismatch: true, ... }` on mismatch rather than throwing.
  `start()` reads the return value and throws from there. Callers that call `detectConfigMismatch()`
  directly for diagnostics should check `hasMismatch`, not catch exceptions.
- `logs()` and `exec()` work after `fromInstanceId()` — `containerIds` is populated from the
  container list fetched during attach.
- `initializeResources()` carries `@internal` JSDoc and should not be called by application code —
  use `start()`. It remains public because the CLI `init` command depends on it.
- `uploadDar()` validates its arguments first (empty target list, `Unknown validator: <name>` both
  throw before any upload), then throws an aggregate error listing all validators whose upload
  failed, including Canton's message for a rejected DAR. It returns nothing.
- `getParties()` lists each hosted party once, under the validator whose participant hosts it (first
  host in SV-then-config order if several do). `getParties(name)` returns only parties hosted on
  `name`. Hosted lists are cached per validator (`parties:<name>`, successes only). `createUser`
  resolves hints with the uncached `fetchHostedParties(validatorName)`, so a hint matches only
  parties hosted on the user's own validator; a hint hosted only elsewhere is allocated afresh on
  the home validator (same hint, different namespace).
- Warning channel: `LocalNetOptions.onWarning` (default `console.warn`) receives `LocalNetWarning`s.
  Partial-failure rule for per-validator queries (`getParties`, `getPackages`, `getUsersWithRights`,
  the users part of `getSnapshot`): a named validator that is unknown or unreachable throws;
  unnamed, each failed validator produces one warning naming it and the others' results are
  returned; if no participant responds, `getParties`/`getPackages`/`getUsersWithRights` throw
  (`getSnapshot` is best-effort and maps that to empty lists). Failures are never cached, so they
  are re-queried (and re-warned) on every call. Runtime query warnings are not stored.

## Editing guidance

- When changing lifecycle order, inspect startup progress messages, CLI behavior, and integration
  tests.
- When changing labels, update discovery utilities and state-2 CLI commands.
- When changing initialization, cover top-level parties, `primaryParty`, `users[].parties[]`,
  rights, Keycloak provisioning, and wallet onboarding.
- When changing cache behavior, test immediate state after mutations.

## Canonical implementation surfaces

- `src/localnet.ts`
- `src/docker/types.ts`
- `src/api/discovery-utils.ts`
- `src/types/state.ts`
- `test/unit/localnet_test.ts`
- `test/integration/localnet_test.ts`
- `test/integration/initialization_test.ts`
- `test/integration/runtime_user_test.ts`
- `test/integration/config_recovery_test.ts`
