# Config Generation

## Scope

- Covers: generated Canton HOCON, Splice app.conf, Keycloak realm JSON, env files, and nginx config.
- Read when: changing generated config strings or troubleshooting generated runtime configuration.
- Excludes: Docker API mechanics after container specs are built.
- Supporting docs: `site/src/content/docs/how-it-works/architecture.md` for diagrams; verify details
  against source.

## What this subsystem is

The generator layer converts `LocalNetConfig` into config strings delivered to containers through
environment variables. A small config can produce the complete Canton, Splice, Keycloak,
environment, and Nginx setup needed by the LocalNet.

## Main modules

- `src/generator/hocon.ts`: Canton participant and synchronizer HOCON.
- `src/generator/splice.ts`: Splice app config, onboarding, parties, JWKS URLs.
- `src/generator/keycloak.ts`: Keycloak realm imports and clients.
- `src/generator/env.ts`: merged environment values.
- `src/docker/nginx.ts`: Nginx reverse proxy config string.
- `src/localnet.ts`: `buildGeneratedConfigs()` assembles the generated configs in memory.

## Working rules

- Validator party hints are generated from validator names, not user config.
- Keycloak realm names used in Splice JWKS URLs must match generated Keycloak realm names exactly.
- Web UI `proxy_pass` entries use a trailing slash; API `proxy_pass` entries do not.
- Nginx uses explicit `server_name` matching and no catch-all `default_server`.
- Keep generated config deterministic so config labels and tests stay stable.

## Critical gotchas

- Nginx API location blocks include `rewrite ^/(.*) /$1 break;`; preserve it when editing routes.
- Nginx `proxy_pass` targets for SV admin and Scan come from `getSvInternalPorts(basePort)` in
  `src/docker/nginx.ts`, the same values the splice app.conf binds and the container publishes
  (`splice:basePort+14` and `splice:basePort+12`). Never hardcode them.
- Splice `target-throughput = 0` is intentional for LocalNet: it avoids reserved traffic
  preconditions and lets local operations proceed without amulets.
- `canton.features.enable-testing-commands = yes` is intentionally enabled for local/test behavior.
- `SPLICE_SV_IS_DEVNET=true` is set on the Splice container.
- Onboarding secrets are deterministic: `validator-{i+1}-onboarding-secret`.
- **Generated config has two shapes, keyed by `spliceVersion`.** `usesSplice010Config()`
  (`src/utils/splice-version.ts`) picks the Splice 0.10 shape for 0.10 and later and for any tag
  that is not a release number: each Splice app's participant Admin API client is
  `admin-api { client-config { address, port }, auth-config.type = "none" }`
  (`participantAdminApiClient()` in `src/generator/splice.ts`), instead of
  `admin-api { address, port }`. Everything else is shared. Canton fails startup on unknown config
  keys (3.5.1 already did for most; 3.6 extended the check to all), so check each new key at every
  tested tag (`git -C <splice> show <tag>:<path>`) and start each tested version before merging.
  Splice ignores unknown keys, but a known key it reads with a different shape fails (Splice 0.6.6's
  `RateLimitersConfig` has no defaults, so `_rate_limiting` repeats `default` and `rate-limiters`).
  Golden fixtures pin the 0.9.4 output (`test/unit/fixtures/generated-0.9.4/`).
- Storage pools are `max-connections = 8` for Canton and Splice. A participant opens
  `1.5 × max-connections + 23` Postgres connections and the sequencer `2 × max-connections`; at 32,
  SV + 2 validators opened 475.
- Scan and the SV app share `_rate_limiting` (`client-ip-headers = []`). Without it every request
  through dnm's nginx shares one 10 requests/s per-client-IP bucket (it sets `X-Real-IP`) and gets
  429s. The validator app does not apply that limiter. `client-ip-headers` exists from Splice 0.7.5;
  0.7.4 keys the limiter through other settings, so `spliceVersion: '0.7.4'` still limits.
- `support-embedded-party-signing-keys = true` sits in `_validator_backend`, so every validator, the
  SV's included, runs wallet automation for external parties onboarded with keys embedded in the
  party-to-participant mapping. Splice 0.6.6 lacks the setting and ignores it.
- `command-service.max-commands-in-flight = 30` is set on the SV participant only; validator
  participants keep Canton's default (256).
- Containers log at INFO, so `_participant` raises `engine.submission-phase-logging.log-level` to
  INFO to keep Daml `debug` output visible.

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
