# Docker Orchestration

## Scope

- Covers: Docker client behavior, container specs, image pins, network setup, health checks, labels,
  ports, and startup order.
- Read when: changing `src/docker/`, port allocation, lifecycle startup, or container
  troubleshooting.
- Excludes: detailed Canton/Splice generated config syntax.
- Supporting docs: `src/docker/types.ts` and `docs/localnet-architecture.md`.

## What this subsystem is

The Docker layer uses Dockerode directly to create a LocalNet without Docker Compose. It builds
container specs, creates a per-instance network, starts containers in dependency layers, waits for
health, and labels resources for discovery and cleanup.

## Main modules

- `src/docker/client.ts`: Dockerode wrapper for containers, networks, volumes, logs, and exec.
- `src/docker/containers.ts`: container specs, image pins, dependency graph, health checks.
- `src/docker/network.ts`: per-instance bridge network management.
- `src/docker/health.ts`: health waiting helpers.
- `src/docker/nginx.ts`: reverse proxy config generation.
- `src/utils/ports.ts`: source of truth for port suffixes and SV internal ports.

## Working rules

- Runtime container names are prefixed with the instance ID: `{instanceId}-{containerName}`.
- Default instance container names are `default-postgres`, `default-canton`, `default-splice`, etc.
- The `splice` container runs all app backends in one process; one bad validator config can take all
  APIs down.
- The `canton` container runs all participant nodes in one process.
- PostgreSQL is shared and creates multiple databases through a generated entrypoint script.
- `DEFAULT_IMAGES` in `src/docker/containers.ts` is the source of truth for image tags.

## Ports

- Suffixes: `httpHealth +0`, `ledgerApi +1`, `adminApi +2`, `validatorAdminApi +3`,
  `grpcHealth +61`, `jsonApi +75`, `webUi +80`, `keycloak +82`.
- SV internal ports include `mediatorAdmin: 5007`, `sequencerPublic: 5008`, `sequencerAdmin: 5009`,
  `scanAdmin: 5012`, `svAdmin: 5014`, `sequencerGrpcHealth: 5062`, `mediatorGrpcHealth: 5063`.
- Regular validator ports are `basePort + ((index + 1) * 100) + suffix`.

## Critical gotchas

- Port conflict detection checks other Docker containers' published ports, not arbitrary host
  processes.
- Bun cannot reliably use Docker Unix sockets through `node:http`; configure Docker over TCP for
  Bun.
- Keycloak 26 health uses management port `9000` inside the container and `/dev/tcp`, not `curl`.
- Nginx uses `restart: 'always'`; most other containers use `unless-stopped`.
- `ansWebUi` exists in `ContainerImages` but no ANS web UI container is currently built.

## Editing guidance

- When changing images, update tests or docs that assert current tags and note override behavior via
  `LocalNetOptions.images`.
- When changing labels, inspect discovery, CLI state commands, `fromInstanceId()`, and cleanup.
- When changing ports, update `src/utils/ports.ts`, generated configs, Nginx, README, and tests.
- Use prefixed container names in troubleshooting examples.

## Canonical implementation surfaces

- `src/docker/client.ts`
- `src/docker/containers.ts`
- `src/docker/network.ts`
- `src/docker/health.ts`
- `src/docker/types.ts`
- `src/utils/ports.ts`
- `test/unit/docker_test.ts`
- `test/integration/docker_client_test.ts`
- `test/integration/network_test.ts`
- `test/integration/postgres_test.ts`
