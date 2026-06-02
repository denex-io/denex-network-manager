# Discovery

## Scope

- Covers: multi-instance discovery server, Docker label parsing, instance reconstruction, and
  discovery CLI command.
- Read when: touching `/instances/*` routes, discovered instance status, labels, or discovery cache.
- Excludes: core `LocalNet` lifecycle except where discovery attaches to instances.
- Supporting docs: `test/unit/discovery_test.ts` and `test/unit/discovery_utils_test.ts`.

## What this subsystem is

Discovery groups Docker containers by LocalNet labels, reconstructs configs from schema-2 labels,
and exposes running instances over an optional foreground Hono HTTP server.

## Main modules

- `src/api/discovery-utils.ts`: label constants, config reconstruction, instance grouping.
- `src/api/discovery.ts`: Hono app, cache, HTTP routes, `node:http` server bridge.
- `src/cli/commands/discovery.ts`: CLI foreground server command.
- `src/localnet.ts`: `fromInstanceId()` and `discover()` factory methods.

## Working rules

- Label constants use `denex.localnet`: `instance`, `config`, and `schema`.
- Schema `2` stores full config JSON in the Docker label.
- Instances with unsupported label schema are surfaced as `unsupported` where possible.
- Discovery routes attach through `LocalNet.fromInstanceId()` instead of reading config files.
- The deprecated YAML `discovery` field does not start this server.

## Routes

- `GET /health`
- `GET /instances`
- `GET /instances/:id/status`
- `GET /instances/:id/env`
- `GET /instances/:id/parties`
- `GET /instances/:id/packages`
- `GET /instances/:id/snapshot`

## Critical gotchas

- `fromInstanceId()` fails when schema is missing or not `2`; discovery may return 410 for
  unsupported instances.
- The discovery cache clears config and LocalNet caches on rediscovery.
- `reconstructConfigFromLabels()` returns `null` on malformed JSON or validation failure.
- The server uses Hono's `app.fetch()` through a `node:http` adapter for cross-runtime code.

## Editing guidance

- When changing label shape, update discovery utils, `LocalNet.fromInstanceId()`, CLI state
  commands, and tests together.
- When adding routes, cover unknown instance and unsupported schema cases.
- Keep discovery read-only unless a user explicitly asks for mutating discovery behavior.

## Canonical implementation surfaces

- `src/api/discovery-utils.ts`
- `src/api/discovery.ts`
- `src/cli/commands/discovery.ts`
- `test/unit/discovery_test.ts`
- `test/unit/discovery_utils_test.ts`
- `test/unit/discovery_integration_test.ts`
