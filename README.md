# denex-localnet

A Testcontainers-style SDK and Deno CLI for running Canton Network LocalNets from a single YAML
file.

`denex-localnet` is for local Canton/Splice development: start a Super Validator, one or more
regular validators, Keycloak, PostgreSQL, Nginx, and the web UIs without maintaining the upstream
LocalNet config tree yourself.

## Requirements

- Docker running locally
- Deno 2.0+ for the CLI
- Deno 2.0+, Node.js 18+, or Bun for the SDK/API layer

The CLI is Deno-only because it uses Cliffy and `Deno.*` APIs. The SDK and low-level API use `node:`
built-ins and are intended to work on Deno, Node.js, and Bun.

**Bun caveat:** Bun does not support Docker Unix sockets reliably through `node:http`. If you use
the SDK from Bun, configure Docker to listen on a TCP socket.

## Quick Start

Create `localnet.yaml`:

```yaml
version: '1.0'

validators: 2

auth:
  keycloak:
    admin: admin
    password: admin
```

Start the LocalNet:

```bash
deno task cli start
```

Check status and endpoints:

```bash
deno task cli status
deno task cli env
deno task cli credentials
```

Stop or destroy it:

```bash
deno task cli stop
deno task cli destroy --force
```

`destroy` removes containers, networks, volumes, and `.localnet/<instance>` data. Without `--force`,
it asks for confirmation.

## CLI

Run the CLI from this repository with:

```bash
deno task cli --help
deno task cli <command> --help
```

Commands:

| Command        | Description                                              |
| -------------- | -------------------------------------------------------- |
| `start`        | Start LocalNet containers                                |
| `stop`         | Stop all containers gracefully                           |
| `status`       | Show container state and health                          |
| `destroy`      | Remove containers, networks, volumes, and generated data |
| `init`         | Initialize users and parties on a running LocalNet       |
| `config`       | Generate `localnet.yaml` interactively                   |
| `parties`      | List parties across validators                           |
| `packages`     | List uploaded DAR packages                               |
| `env`          | Show API URLs, auth config, and DSO party ID             |
| `credentials`  | Show web UI login credentials                            |
| `instances`    | List running LocalNet instances                          |
| `entitlements` | List users with their rights                             |
| `discovery`    | Run the multi-instance discovery HTTP server             |

Only `start` and `config` accept `--config <path>`. State commands attach to running Docker
containers through labels. If multiple instances are running, pass `--instance <id>`.

Useful options:

```bash
deno task cli config -y -o localnet.yaml
deno task cli start --instance demo --timeout 300000
deno task cli start --skip-init
deno task cli start --skip-health-checks
deno task cli env --json
deno task cli env --shell
deno task cli credentials --json
```

## Web UIs And Credentials

Default ports use base port `5000`:

| URL                            | Service                       | Default login                 |
| ------------------------------ | ----------------------------- | ----------------------------- |
| `http://sv.localhost:5080`     | Super Validator management UI | `sv` / `sv`                   |
| `http://scan.localhost:5080`   | Scan explorer                 | `sv` / `sv` if prompted       |
| `http://wallet.localhost:5080` | SV wallet                     | `sv` / `sv`                   |
| `http://wallet.localhost:5180` | Validator 1 wallet            | `validator-1` / `validator-1` |
| `http://wallet.localhost:5280` | Validator 2 wallet            | `validator-2` / `validator-2` |

For custom validators, the default wallet user is the validator name with the same value as the
password. YAML-defined users also use `id` as the default password.

The `auth.keycloak.admin` and `auth.keycloak.password` values configure the persistent Keycloak
master realm admin. They are not validator wallet credentials.

## Configuration

The Super Validator is always created automatically. Configure only regular validators.

Minimal config:

```yaml
version: '1.0'
validators: 2
auth:
  keycloak:
    admin: admin
    password: admin
```

Detailed config:

```yaml
version: '1.0'
basePort: 6000

validators:
  - name: app
    parties:
      - hint: app-operator
        displayName: App Operator
    users:
      - id: app-operator
        primaryParty: app-operator
      - id: app-admin
        rights: [ParticipantAdmin]
  - name: users-val
    parties:
      - hint: alice
      - hint: bob
    users:
      - id: alice
        primaryParty: alice
      - id: bob
        primaryParty: bob
        parties:
          - hint: alice
            rights: [CanReadAs]

auth:
  keycloak:
    admin: admin
    password: admin
```

User rights are split into participant-wide rights and per-party rights:

- Participant-wide: `ParticipantAdmin`, `CanReadAsAnyParty`, `CanExecuteAsAnyParty`,
  `IdentityProviderAdmin`
- Per-party: `CanActAs`, `CanReadAs`, `CanExecuteAs`

`primaryParty` grants `CanActAs` on that party. Entries in `users[].parties` grant additional
per-party rights and default to `CanActAs` when `rights` is omitted. Party hints referenced by users
are auto-allocated if they are not listed under the validator's top-level `parties`.

Party hints supplied by users are normalized for Canton when needed. Validator operator party hints
are generated separately from validator names.

## Port Allocation

Ports use `basePort` with `+100` increments per validator:

| Service             | SV   | Validator 1 | Validator 2 |
| ------------------- | ---- | ----------- | ----------- |
| HTTP health         | 5000 | 5100        | 5200        |
| Ledger API          | 5001 | 5101        | 5201        |
| Admin API           | 5002 | 5102        | 5202        |
| Validator Admin API | 5003 | 5103        | 5203        |
| gRPC                | 5061 | 5161        | 5261        |
| JSON API            | 5075 | 5175        | 5275        |
| Web UI              | 5080 | 5180        | 5280        |
| Keycloak            | 5082 | -           | -           |

With `basePort: 6000`, the same layout starts at `6000`, `6100`, `6200`, and so on.

## SDK Usage

Use `@denex/localnet/sdk` for the common surface:

```typescript
import { LocalNet, LocalNetBuilder } from '@denex/localnet/sdk';

const net = await LocalNet.fromConfig('./localnet.yaml', {
  instanceId: 'demo',
});

await net.start();

const env = await net.getEnvironment();
const credentials = await net.getCredentials();
const parties = await net.getParties();

await net.stop();
```

Build config in code:

```typescript
const config = LocalNetBuilder.create()
  .addValidator('app', {
    parties: ['app-operator'],
    users: [{ id: 'app-operator', primaryParty: 'app-operator' }],
  })
  .addValidator('users-val', { parties: ['alice', 'bob'] })
  .withBasePort(6000)
  .withAuth('admin', 'admin')
  .build();

const net = await LocalNet.fromConfig(config);
await net.start();
```

Attach to a running instance without a config file:

```typescript
const net = await LocalNet.fromInstanceId('demo');
const status = await net.status();
const snapshot = await net.getSnapshot();
```

Create users and upload DARs after startup:

```typescript
await net.createUser('alice', 'users-val', {
  primaryParty: 'alice',
  parties: [{ hint: 'bob', rights: ['CanReadAs'] }],
});

const packageId = await net.uploadDar('./my-app.dar');
await net.uploadDar('./my-app.dar', ['app', 'users-val']);
```

`createUser` provisions the ledger user, Keycloak user, and wallet onboarding. It is idempotent per
side, so retries converge after partial failures.

Advanced users can import the full API from `@denex/localnet`, including `CantonClient`,
`ValidatorAdminClient`, generators, schemas, Docker helpers, and discovery utilities.

## Discovery Server

The discovery server is a separate foreground process for querying running instances over HTTP. It
is not started from `localnet.yaml`; the `discovery` config field is deprecated.

```bash
deno task cli discovery serve --port 3100 --host 127.0.0.1
```

Useful routes:

- `GET /health`
- `GET /instances`
- `GET /instances/:id/status`
- `GET /instances/:id/env`
- `GET /instances/:id/parties`
- `GET /instances/:id/packages`
- `GET /instances/:id/snapshot`

Example:

```bash
curl http://127.0.0.1:3100/instances
curl http://127.0.0.1:3100/instances/demo/env
```

## Development

```bash
deno task check
deno task fmt:check
deno task lint
deno task test:unit
deno task test:integration
deno task test
```

Integration tests require Docker and may start containers. Unit tests do not require Docker.

Useful development references are upstream, not vendored here:

- Splice: https://github.com/canton-network/splice
- Canton Network Quickstart: https://github.com/digital-asset/cn-quickstart

If you need local checkouts, clone them under `.references/`:

```bash
mkdir -p .references
git clone https://github.com/canton-network/splice .references/splice
git clone https://github.com/digital-asset/cn-quickstart .references/cn-quickstart
```

`.references/` is ignored by git.

## Troubleshooting

**502 Bad Gateway on API routes:** the `splice` container is likely crash-looping. Check
`docker logs splice` for fatal errors. A bad validator config can take all Splice APIs offline
because SV, Scan, and validator apps run in one process.

**401 Unauthorized from wallet APIs:** verify Keycloak realm names. Validator realm names are
title-cased from validator names, for example `validator-1` becomes `Validator1` and
`alice-validator` becomes `AliceValidator`.

**Web UI loads but spins forever:** the static UI is reachable but the backend API is unhealthy or
unreachable. Check `deno task cli status` and the relevant container logs.

**Splice reports "Node name is too long":** use shorter validator names. Splice limits generated
node names to 30 characters.

## License

MIT
