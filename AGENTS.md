# denex-localnet Agent Notes

This file is for coding agents working in this repository. It is intentionally not a user manual.

## What denex-localnet is

`denex-localnet` is a Testcontainers-style SDK and Deno CLI for running Canton Network LocalNets
from one YAML file. It starts a Super Validator, regular validators, Canton, Splice, Keycloak,
PostgreSQL, Nginx, and web UIs using the Docker API directly, not Docker Compose.

## Repo-level rules

### Keep root AGENTS.md small

- Keep this file focused on durable repo-wide rules and orientation.
- Put subsystem-specific implementation guidance in `agents/*.md`.
- Before changing a subsystem, read `agents/INDEX.md` and then the relevant subject file.
- User-facing docs belong in `README.md`; detailed agent implementation notes belong in `agents/`.

### Cross-runtime split

- `src/cli/` is Deno-only and may use `Deno.*`, Cliffy, and `@std/*` CLI conveniences.
- Cross-runtime code is `src/` excluding `src/cli/`; it must stay usable from Deno 2.0+, Node.js
  18+, and Bun where Docker socket support permits.
- Do not introduce `Deno.*` or `@std/*` imports into cross-runtime code.
- Prefer `node:` built-ins in cross-runtime code (`node:fs/promises`, `node:http`, `node:net`,
  `node:path`, `node:process`).
- YAML parsing differs by layer: SDK/API uses `npm:yaml`; CLI may use `@std/yaml`.

### Safety and scope

- Match existing TypeScript style and strictness; do not use `any`, `as any`, `@ts-ignore`, or
  `@ts-expect-error`.
- Fix only issues related to the task. Do not refactor neighboring systems just because they are
  nearby.
- Do not weaken failing tests. If failures pre-exist, name them in the final report.
- Do not assume Docker integration tests are cheap; target tests first, then run broader checks when
  the change warrants it.

## Project shape

```text
src/
  mod.ts              full public API barrel export
  localnet.ts         LocalNet lifecycle, state queries, factories, createLocalNet
  sdk/                curated SDK entry point and LocalNetBuilder
  types/              core config and state types
  schemas/            Zod validation and defaults
  utils/              YAML loading, ports, credentials, env info, fetch helpers
  generator/          Canton HOCON, Splice app.conf, Keycloak realms, env generation
  docker/             Dockerode client, container specs, network, health, nginx
  api/                Canton, Validator Admin, Keycloak Admin, auth, discovery
  cli/                Deno-only Cliffy commands

test/
  unit/               fast tests that do not require Docker
  integration/        Docker-backed tests; auto-skip when Docker is unavailable
  smoke/              cross-runtime compatibility checks
```

Empty or historical directories exist in the repo. Do not treat `examples/*` as current reference
material until populated. `src/canton-client/`, `src/discovery-server/`, `src/orchestrator/`, and
`src/state/` may exist as empty or legacy stubs; ignore them unless populated. Treat
`docs/research/` and `docs/plans/implementation-plan.md` as historical/supporting context, not
current implementation specs.

## Subject-specific context

Use `agents/INDEX.md` as the entry point for detailed guidance. Important examples:

- Canton/Splice domain concepts: `agents/canton-concepts.md`
- Config schema and YAML loading: `agents/config-schema.md`
- Generated Canton/Splice/Keycloak/Nginx configs: `agents/config-generation.md`
- Docker orchestration and ports: `agents/docker-orchestration.md`
- Auth and Keycloak: `agents/auth-and-keycloak.md`
- API clients and wire types: `agents/api-clients.md`
- `LocalNet` lifecycle and public API: `agents/localnet-lifecycle.md`
- SDK builder and exports: `agents/sdk-and-builder.md`
- CLI command behavior: `agents/cli-commands.md`
- Discovery server and Docker labels: `agents/discovery.md`
- Tests and verification: `agents/testing.md`

## Development commands

```bash
deno task check
deno task fmt:check
deno task lint
deno task test:unit
deno task test:integration
deno task test
```

Browser integration tests require Chromium for Playwright:

```bash
deno task playwright:install
```

Run the CLI from this repo with:

```bash
deno task cli --help
deno task cli <command> --help
```

## Verification expectations

- For code changes, run `lsp_diagnostics` on touched TypeScript files.
- Run `deno task check` for TypeScript/API changes.
- Run targeted unit tests for the affected subsystem.
- Run integration tests when changing Docker orchestration, startup, auth, Keycloak, LocalNet
  lifecycle, browser/UI routing, or live Canton/Splice behavior.
- Run `test/smoke/node-compat.mjs` when changing cross-runtime imports, exports, SDK entry points,
  or anything that might leak Deno-only APIs.
- For CLI behavior, drive the CLI through `deno task cli ...` after tests.

## Operational gotchas

- Runtime Docker container names are prefixed with the instance ID, for example `default-splice` or
  `demo-nginx`. Do not use bare names like `splice` or `nginx` in troubleshooting unless you have
  verified they exist.
- The `splice` container runs all Splice backends in one process. A bad validator config can take
  SV, Scan, and every validator API offline.
- `packages:` in YAML is parsed and validated, but startup does not currently auto-upload those
  DARs. Use `LocalNet.uploadDar()` for runtime upload.
- The `discovery` YAML field is deprecated and does not start a discovery server. Run
  `deno task cli discovery serve` explicitly.
- `reference/splice` is a local/external source reference, not a stable repo artifact. Prefer
  upstream URLs or clone references under `.references/` when needed.
