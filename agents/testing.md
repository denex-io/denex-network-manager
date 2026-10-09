# Testing

## Scope

- Covers: test categories, verification commands, integration-test conventions, browser tests, and
  cross-runtime smoke checks.
- Read when: adding tests, selecting verification, debugging test setup, or changing runtime
  imports.
- Excludes: subsystem-specific expected behavior except where tests encode it.
- Supporting docs: `deno.json` tasks.

## What this subsystem is

Tests are split into fast unit tests, Docker-backed integration tests, and a Node compatibility
smoke test. Integration tests are expensive and may start real containers, but they are the only
reliable proof for Docker, Keycloak, Splice, browser UI, and live API flows.

## Commands

```bash
deno task check
deno task fmt:check
deno task lint
deno task test:unit
deno task test:smoke
deno task test:integration
deno task test
deno task playwright:install
```

## Unit tests

- `test/unit/api_test.ts`
- `test/unit/cli_test.ts`
- `test/unit/config_test.ts`
- `test/unit/discovery_integration_test.ts`
- `test/unit/discovery_test.ts`
- `test/unit/discovery_utils_test.ts`
- `test/unit/docker_fake_engine_test.ts`
- `test/unit/docker_stream_test.ts`
- `test/unit/docker_test.ts`
- `test/unit/generator_test.ts`
- `test/unit/keycloak_admin_test.ts`
- `test/unit/localnet_start_test.ts` (start-rollback with a fake Docker client)
- `test/unit/localnet_test.ts`
- `test/unit/sdk_test.ts`

## Integration tests

- `test/integration/auth_confidence_test.ts`
- `test/integration/cli_test.ts`
- `test/integration/config_recovery_test.ts`
- `test/integration/docker_client_test.ts`
- `test/integration/e2e_browser_test.ts`
- `test/integration/entitlements_test.ts`
- `test/integration/initialization_test.ts`
- `test/integration/keycloak_master_realm_test.ts`
- `test/integration/localnet_test.ts`
- `test/integration/network_test.ts`
- `test/integration/postgres_test.ts`
- `test/integration/runtime_user_test.ts`
- `test/integration/transfer_test.ts`
- `test/integration/multi_instance_test.ts`
- `test/integration/wallet_ui_test.ts`
- `test/integration/helpers.ts`

## Working rules

- Integration tests call `isDockerAvailable()` and auto-skip when Docker is unavailable.
- Use unique instance IDs from `generateTestInstanceId()`.
- Always clean up containers, networks, volumes, and `.localnet` data.
- Use `localnetFetch()` for `*.localhost` URLs in Deno tests when DNS or Host header behavior
  matters.
- Browser tests require Playwright Chromium; install with `deno task playwright:install`.
- The smoke test guards cross-runtime boundaries and should run after export/import changes:
  `deno task test:smoke` (runs `test/smoke/node-compat.mjs`).

## Critical gotchas

- Browser tests may write evidence under `.sisyphus/evidence`.
- `skipHealthChecks: true` can speed lifecycle-oriented integration tests, but do not use it when
  the test is supposed to prove health behavior.
- Auth tests may run long enough that short-lived tokens need refresh or reacquisition.
- Docker cleanup helpers use labels and instance IDs; label changes can strand resources.

## Editing guidance

- Add focused unit tests for pure config/generator/client behavior.
- Add integration tests for behavior that only exists with real Docker, Keycloak, Canton, Splice, or
  browser UIs.
- For CLI changes, run the command help and at least one representative command through the CLI.
- For docs-only changes, run `deno task fmt:check` and manually review links/structure.

## Canonical implementation surfaces

- `test/unit/`
- `test/integration/`
- `test/smoke/node-compat.mjs`
- `test/integration/helpers.ts`
- `src/utils/fetch.ts`
- `deno.json`

## Fake Docker client and basePort conventions

- To unit-test `LocalNet.start()` without Docker, build a `FakeDockerClient` that records every
  mutating call (see `test/unit/localnet_start_test.ts`) and inject it with
  `Reflect.set(net, 'client', fake as unknown as DockerClient)` plus
  `Reflect.set(net, 'networkManager', new NetworkManager(fake as unknown as DockerClient, { prefix }))`.
  Stub `globalThis.fetch` too, otherwise `deleteBootstrapAdmin` could reach a real Keycloak.
- basePort convention: fake-Docker unit tests use 41000; new integration tests use a dedicated
  basePort of 21000, 22000 or 23000 with `generateTestInstanceId()`. Avoid 5000, 5500-5700,
  7000-7999 (live-validation harness range; `auth_confidence_test` already uses 7000), 8000, 8100
  and 17000-19000.
