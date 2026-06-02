# API Clients

## Scope

- Covers: Canton Ledger API, Validator Admin API, Keycloak Admin API, auth helpers, wire-level state
  types, and right helper functions.
- Read when: touching `src/api/`, right grant/revoke behavior, package upload, or runtime state
  APIs.
- Excludes: LocalNet lifecycle orchestration except where it calls these clients.
- Supporting docs: `test/integration/auth_confidence_test.ts` and `test/unit/api_test.ts`.

## What this subsystem is

The API layer wraps Canton JSON Ledger API v2, Splice Validator Admin API, Keycloak Admin API, and
discovery HTTP responses. `LocalNet` composes these clients for state queries, resource
initialization, user creation, and DAR uploads.

## Main modules

- `src/api/canton.ts`: `CantonClient`, right helpers, package upload, Canton errors.
- `src/api/validator.ts`: `ValidatorAdminClient`, wallet and validator state operations.
- `src/api/keycloak-admin.ts`: runtime Keycloak user provisioning.
- `src/api/auth.ts`: token acquisition and auth header creation.
- `src/api/state-types.ts`: API-facing state response types.
- `src/api/discovery.ts`: HTTP discovery server response types.

## Working rules

- Types with `Api` prefix are wire/API-level shapes, not necessarily SDK-friendly abstractions.
- Canton right wire format uses a `value` wrapper for every right type.
- 409 responses are often convergence/idempotency signals for create/onboard paths.
- `CantonClient.forUser()` is the preferred factory for per-user Ledger API access in tests and
  runtime checks.

## Critical gotchas

- Per-party right wire shape: `{ kind: { CanActAs: { value: { party } } } }`.
- Participant-wide right wire shape: `{ kind: { ParticipantAdmin: { value: {} } } }`.
- `getSnapshot()` returns users without rights; use `getUsersWithRights()` for entitlements.
- `uploadDarFromFile()` reads a DAR and delegates to `uploadDar()`; `LocalNet.uploadDar()` handles
  multi-validator upload and cache invalidation.
- `TokenManager` must honor configured Keycloak URL and realm/client IDs.

## Editing guidance

- When changing rights, update helper functions, tests, CLI entitlement formatting, and docs.
- When adding client methods, add unit tests for request/response shape and integration tests when
  live behavior matters.
- When changing auth behavior, run auth confidence tests if Docker is available.

## Canonical implementation surfaces

- `src/api/canton.ts`
- `src/api/validator.ts`
- `src/api/keycloak-admin.ts`
- `src/api/auth.ts`
- `src/api/state-types.ts`
- `test/unit/api_test.ts`
- `test/integration/auth_confidence_test.ts`
