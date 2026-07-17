# Config Generation

## Scope

- Covers: generated Canton HOCON, Splice app.conf, Keycloak realm JSON, env files, and nginx config.
- Read when: changing generated config strings or troubleshooting generated runtime configuration.
- Excludes: Docker API mechanics after container specs are built.
- Supporting docs: `docs/localnet-architecture.md` for diagrams; verify details against source.

## What this subsystem is

The generator layer converts `LocalNetConfig` into files mounted into containers. A small config can
produce the complete Canton, Splice, Keycloak, environment, and Nginx setup needed by the LocalNet.

## Main modules

- `src/generator/hocon.ts`: Canton participant and synchronizer HOCON.
- `src/generator/splice.ts`: Splice app config, onboarding, parties, JWKS URLs.
- `src/generator/keycloak.ts`: Keycloak realm imports and clients.
- `src/generator/env.ts`: merged environment values.
- `src/docker/nginx.ts`: Nginx reverse proxy config string.
- `src/localnet.ts`: writes generated files to the instance config directory.

## Working rules

- Validator party hints are generated from validator names, not user config.
- Keycloak realm names used in Splice JWKS URLs must match generated Keycloak realm names exactly.
- Web UI `proxy_pass` entries use a trailing slash; API `proxy_pass` entries do not.
- Nginx uses explicit `server_name` matching and no catch-all `default_server`.
- Keep generated config deterministic so config labels and tests stay stable.

## Critical gotchas

- Nginx API location blocks include `rewrite ^/(.*) /$1 break;`; preserve it when editing routes.
- **Nginx proxy targets for SV admin and Scan are hardcoded** (`5014` and `5012` respectively) in
  `src/docker/nginx.ts` and are not derived from `getSvInternalPorts()`. These values are only
  correct at the default `basePort=5000`. A LocalNet started on a non-default basePort will have
  Nginx proxying to the wrong host ports for those two paths. This is an open correctness issue; fix
  it before adding production-non-default-basePort Nginx support.
- Splice `target-throughput = 0` is intentional for LocalNet: it avoids reserved traffic
  preconditions and lets local operations proceed without amulets.
- `canton.features.enable-testing-commands = yes` is intentionally enabled for local/test behavior.
- `SPLICE_SV_IS_DEVNET=true` is set on the Splice container.
- Onboarding secrets are deterministic: `validator-{i+1}-onboarding-secret`.

## Editing guidance

- When changing generated strings, add or update generator unit tests before running integration
  tests.
- When changing realm/client IDs, update Keycloak, Splice, web UI env, auth tests, and README/agents
  docs together.
- When changing Nginx routing, verify rendered config and drive a browser or HTTP request through
  the actual hostnames.

## Canonical implementation surfaces

- `src/generator/hocon.ts`
- `src/generator/splice.ts`
- `src/generator/keycloak.ts`
- `src/generator/env.ts`
- `src/docker/nginx.ts`
- `test/unit/generator_test.ts`
- `test/unit/docker_test.ts`
