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
- `start()` calls `detectConfigMismatch()` and is idempotent when matching containers are already
  running.
- `start()` runs `initializeResources()` unless `skipInitialization` is set.
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
- `start()` sets `internalState = 'error'` only when containers were actually created before the
  failure. Pre-container failures (Docker unavailable, port conflict, config gen error) reset state
  to `'stopped'` so the instance can be started again without reconstruction.
- `detectConfigMismatch()` returns `{ hasMismatch: true, ... }` on mismatch rather than throwing.
  `start()` reads the return value and throws from there. Callers that call `detectConfigMismatch()`
  directly for diagnostics should check `hasMismatch`, not catch exceptions.
- `logs()` and `exec()` work after `fromInstanceId()` — `containerIds` is populated from the
  container list fetched during attach.
- `initializeResources()` carries `@internal` JSDoc and should not be called by application code —
  use `start()`. It remains public because the CLI `init` command depends on it.
- `uploadDar()` throws an aggregate error listing all failed validators; it does not swallow
  individual upload failures silently.

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
