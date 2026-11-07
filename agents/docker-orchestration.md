# Docker Orchestration

## Scope

- Covers: Docker client behavior, container specs, image pins, network setup, health checks, labels,
  ports, and startup order.
- Read when: changing `src/docker/`, port allocation, lifecycle startup, or container
  troubleshooting.
- Excludes: detailed Canton/Splice generated config syntax.
- Supporting docs: `src/docker/types.ts` and `site/src/content/docs/how-it-works/architecture.md`.

## What this subsystem is

The Docker layer uses Dockerode directly to create a LocalNet without Docker Compose. It builds
container specs, creates a per-instance network, starts containers in dependency layers, waits for
health, and labels resources for discovery and cleanup.

## Main modules

- `src/docker/client.ts`: Dockerode wrapper for containers, networks, volumes, logs, and exec.
- `src/docker/stream.ts`: internal Docker stream demultiplexer (`DockerStreamDemuxer`,
  `demuxDockerOutput`, `concatBytes`); no runtime-specific APIs.
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
- Resource settings live in `src/docker/containers.ts`: canton and splice get
  `JAVA_TOOL_OPTIONS =
  JVM_MEMORY_OPTIONS` (G1 returns unused heap to the OS; no heap cap, since
  Canton's heap grows with the DARs loaded) and `LOG_LEVEL_CANTON`/`LOG_LEVEL_STDOUT = INFO` (the
  images default to DEBUG, and nothing rotates container logs). Keycloak gets
  `JAVA_OPTS_KC_HEAP =
  KEYCLOAK_HEAP_OPTIONS`; without it Keycloak may grow to 70% of the Docker
  VM. Postgres gets `POSTGRES_INITDB_ARGS=--data-checksums`, which only applies when a data volume
  is first created. All of these reach existing instances only through containers a repair
  recreates.

## Ports

- Suffixes: `httpHealth +0`, `ledgerApi +1`, `adminApi +2`, `validatorAdminApi +3`,
  `grpcHealth +61`, `jsonApi +75`, `webUi +80`, `keycloak +82`.
- Regular validator ports are `basePort + ((index + 1) * 100) + suffix`.
- **All SV-only ports are basePort-relative** via `getSvInternalPorts(basePort)` in
  `src/utils/ports.ts` (offsets in `SV_INTERNAL_PORT_OFFSETS`): `mediatorAdmin +7`,
  `sequencerPublic +8`, `sequencerAdmin +9`, `scanAdmin +12`, `splicePrometheus +13`, `svAdmin +14`,
  `sequencerGrpcHealth +62`, `mediatorGrpcHealth +63`, `cantonPrometheus +64`. Sequencer and
  mediator ports are bound inside `canton`, Scan/SV admin inside `splice`. Only Scan and SV admin
  are published to the host, and the container port equals the host port. The two Prometheus offsets
  are reserved: the generated configs set no metrics reporter, so nothing binds them.
- All offsets are below 100 and distinct from `PORT_SUFFIXES`, so no SV-level port can equal a
  validator port. `test/unit/ports_test.ts` brute-forces this.
- `SV_INTERNAL_PORTS` no longer exists. The helpers are internal: they are not exported from
  `src/mod.ts`.

## Volumes

- Postgres data lives in the named Docker volume `<instanceId>-postgres-data`, created in
  `LocalNet.start()` before `buildContainerSpecs()` is called and labelled with
  `denex.localnet.instance`. `destroy()` removes it via the existing instance-label volume query. A
  failed `start()` removes it only if that call created it (`findVolume` returned 404 first), so a
  failed resume keeps the data.
- The volume mount follows the Postgres image's major version (`postgresDataMount()` in
  `src/docker/containers.ts`): `/var/lib/postgresql` for 18 and later (data lands in
  `<major>/docker`), `/var/lib/postgresql/data` for earlier majors. The 18 image refuses to start
  with a mount at `/var/lib/postgresql/data`, even an empty one, and an earlier image declares its
  own volume there, so the wrong path either fails or puts the data in an anonymous volume, which a
  container recreate discards (`removeContainer` removes anonymous volumes). The major comes from
  the tag (a `pg<major>` token, else the leading number); a digest or a tag without a version is
  treated as 18 or later. `test/integration/postgres_volume_test.ts` checks both layouts. A Postgres
  14 volume from an older dnm cannot be opened by 18 without `pg_upgrade`; recreate such instances
  instead.
- Generated configs (Canton/Splice HOCON, Keycloak realms, nginx.conf, postgres init script) are
  built in memory by `buildGeneratedConfigs()` and delivered through container environment
  variables. There are no host bind mounts, which is why the SDK works over a remote Docker socket.
- `ContainerBuilderOptions.instanceId` is used to derive the volume name in
  `buildPostgresContainer()`; falls back to `labelPrefix` if not provided.

## Critical gotchas

- Containers run without a TTY, so logs and exec output are multiplexed with 8-byte frame headers.
  `getContainerLogs` and `execInContainer` demultiplex them (`Config.Tty` is checked via inspect for
  logs; exec is created with `Tty: false`). `getContainerLogs({ follow: false })` is a buffer, not a
  stream, in dockerode; the client wraps it in a one-shot `ReadableStream`. Followed logs honour
  backpressure and `cancel()` destroys the connection.
- `execInContainer` settles on `end`, `error` and `close`, retries `exec.inspect()` briefly until an
  exit code is recorded, and rejects on output cut mid-frame. If the `hijack: true` start ever hangs
  on a real Unix-socket daemon, fall back to `exec.start({ hijack: false, stdin: false })`.
- Port conflict detection checks other Docker containers' published ports, not arbitrary host
  processes.
- Bun cannot reliably use Docker Unix sockets through `node:http`; configure Docker over TCP for
  Bun.
- Keycloak 26 health uses management port `9000` inside the container and `/dev/tcp`, not `curl`.
- Nginx `dependsOn` splice and every web UI (wallet UIs, sv, scan), so it starts in its own layer
  after them and is restarted when one of them is restarted by a repair (nginx resolves upstream
  addresses once).
- Nginx uses `restart: 'always'`; postgres, canton, splice and keycloak use `unless-stopped`; the
  web UI containers have no restart policy.
- `ansWebUi` exists in `ContainerImages` but no ANS web UI container is currently built.
- Every bind (HOCON/app.conf), Docker port mapping, healthcheck, nginx `proxy_pass` and in-process
  URL for an SV-only port must use the same `getSvInternalPorts(basePort)` value. A mismatch between
  them was the 0.1.0-beta.1 bug (mapping pointed at a port nothing listened on).
- Both images' `monitoring.conf` bind a Prometheus reporter on a fixed port (10013), which can
  collide with a derived port at some basePorts (observed in a running instance). The generated
  configs set `canton.monitoring.metrics.reporters = []` (HOCON replaces arrays), so neither image
  binds any reporter; nothing in dnm read the metrics, and it saves about 35 MB of native memory per
  JVM. `basePort + 13` and `basePort + 64` stay reserved if a reporter is ever re-enabled.

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
- `test/unit/docker_stream_test.ts`
- `test/unit/docker_fake_engine_test.ts` (fake Engine API on loopback TCP)
- `test/integration/docker_client_test.ts`
- `test/integration/network_test.ts`
- `test/integration/postgres_test.ts`
