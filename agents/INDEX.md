# Agent Context Index

Use `AGENTS.md` first for repo-wide rules. This directory holds subject-specific implementation
guidance for coding agents working in deeper parts of the system.

Read the relevant file here before making changes in that subsystem. These files should be
implementation-facing and current-state oriented. Historical research in `docs/research/` can help
with Canton background, but it is not the operational source of truth.

## Subject files

| File                      | Read when                                                                                                      | Covers                                                                                             | Supporting docs                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `canton-concepts.md`      | Touching party, user, rights, validator, SV, audience, or Canton naming logic                                  | Canton/Splice domain model, party hints, user rights, realm naming, node-name limits               | `docs/research/canton-localnet-deep-analysis.md`                               |
| `config-schema.md`        | Adding config fields, changing Zod schemas, YAML loading, defaults, or env expansion                           | `src/types/config.ts`, `src/schemas/`, `src/utils/yaml.ts`                                         | `README.md`                                                                    |
| `config-generation.md`    | Changing HOCON, Splice app.conf, Keycloak realm JSON, env vars, or nginx config generation                     | `src/generator/`, `src/docker/nginx.ts`                                                            | `docs/localnet-architecture.md`                                                |
| `docker-orchestration.md` | Touching container specs, image versions, health checks, networks, labels, ports, or startup order             | `src/docker/`, `src/utils/ports.ts`, Docker portions of `src/localnet.ts`                          | `src/docker/types.ts`                                                          |
| `auth-and-keycloak.md`    | Changing Keycloak realms, JWKS URLs, OAuth2 token flow, auth clients, or runtime user provisioning             | `src/generator/keycloak.ts`, `src/api/auth.ts`, `src/api/keycloak-admin.ts`                        | `src/generator/splice.ts`                                                      |
| `api-clients.md`          | Touching Canton Ledger API, Validator Admin API, Keycloak Admin API, wire types, or right helpers              | `src/api/canton.ts`, `src/api/validator.ts`, `src/api/keycloak-admin.ts`, `src/api/state-types.ts` | `test/integration/auth_confidence_test.ts`                                     |
| `localnet-lifecycle.md`   | Changing `LocalNet`, lifecycle methods, initialization, labels, cache, static factories, or runtime operations | `src/localnet.ts`                                                                                  | `test/integration/localnet_test.ts`, `test/integration/initialization_test.ts` |
| `sdk-and-builder.md`      | Changing SDK exports, full exports, `LocalNetBuilder`, builder types, or package entry points                  | `src/sdk/`, `src/mod.ts`, `deno.json` exports                                                      | `test/unit/sdk_test.ts`, `test/smoke/node-compat.mjs`                          |
| `cli-commands.md`         | Adding or changing CLI commands, state command patterns, output formatting, or instance auto-discovery         | `src/cli/`, `src/utils/credentials.ts`, `src/utils/env-info.ts`                                    | `README.md` CLI section                                                        |
| `discovery.md`            | Touching the discovery server, Docker label parsing, instance listing, or `/instances/*` routes                | `src/api/discovery.ts`, `src/api/discovery-utils.ts`, `src/cli/commands/discovery.ts`              | `test/unit/discovery_test.ts`, `test/unit/discovery_utils_test.ts`             |
| `testing.md`              | Writing or fixing tests, choosing verification commands, or changing cross-runtime behavior                    | `test/unit/`, `test/integration/`, `test/smoke/`, `test/integration/helpers.ts`                    | `deno.json` tasks                                                              |

## Companion repo artifacts

| File                                   | Read when                                               | Covers                                                                         |
| -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `../README.md`                         | Checking user-facing CLI/SDK behavior or examples       | Canonical user-facing overview and command reference                           |
| `../deno.json`                         | Checking tasks, exports, imports, or compiler options   | Source of truth for Deno tasks and package entry points                        |
| `../docs/localnet-architecture.md`     | Needing diagrams or broader architecture orientation    | Useful architecture reference; verify image tags and ports against source code |
| `../docs/research/`                    | Researching Canton/Splice background or project history | Historical research; may contain stale implementation details                  |
| `../docs/plans/implementation-plan.md` | Understanding original planning context                 | Historical plan; not a current implementation spec                             |
