# denex-localnet - Agent Instructions

A Testcontainers-style SDK and CLI for running Canton Network LocalNets.

## Project Overview

This project simplifies Canton LocalNet management from 60-100+ config files down to a single YAML
file. It provides:

- **CLI** (`src/cli/`) - Command-line interface for managing LocalNets (Deno-only)
- **SDK** (`src/sdk/`) - Curated entry point re-exporting `LocalNet`, `LocalNetBuilder`,
  `createLocalNet` (cross-runtime)
- **Full API** (`src/mod.ts`) - Low-level exports: `LocalNet`, `CantonClient`,
  `ValidatorAdminClient`, generators, schemas (cross-runtime)
- **Docker orchestration** - Direct Docker API control (not Docker Compose)
- **API clients** - Canton Ledger API and Validator Admin API clients

## Tech Stack

- **Runtime**: Deno 2.0+, Node.js 18+, or Bun (SDK/API layer). CLI is Deno-only.
- **Language**: TypeScript (strict mode)
- **CLI Framework**: Cliffy (Deno-only, `src/cli/`)
- **HTTP Server**: Hono (via `node:http` createServer)
- **Docker**: Dockerode (npm package)
- **Validation**: Zod schemas
- **Config**: YAML with environment variable expansion (`npm:yaml` in SDK, `@std/yaml` in CLI)

## Project Structure

```
src/
├── mod.ts              # Full exports - everything from here
├── localnet.ts         # Unified LocalNet class (lifecycle + state queries) + createLocalNet factory
├── sdk/                # Curated SDK entry point (cross-runtime)
│   ├── mod.ts          # Re-exports LocalNet, LocalNetBuilder, helpers
│   ├── types.ts        # SDK-specific types (ValidatorSpec, UserSpec, etc.)
│   └── builder.ts      # LocalNetBuilder fluent API
├── types/              # Core type definitions (LocalNetConfig, etc.)
├── schemas/            # Zod validation schemas
├── utils/              # YAML loader, port allocation
│   ├── credentials.ts  # getCredentials() - relocated from CLI layer
│   ├── env-info.ts     # buildConfigEnvironmentInfo()
│   ├── ports.ts        # Port allocation logic
│   ├── yaml.ts         # YAML loading with env var expansion
│   └── ...
├── generator/          # Config generators (HOCON, Splice, Keycloak, Nginx)
├── docker/             # Container orchestration primitives (client, network, containers, nginx, health)
├── api/                # Canton/Validator API clients, discovery server, state types
└── cli/                # Cliffy CLI commands (Deno-only)
    └── commands/       # Individual command implementations
        ├── config.ts       # Interactive config generator
        ├── credentials.ts  # Show web UI login credentials
        ├── env.ts          # Show API URLs and auth config
        ├── start.ts        # Start LocalNet
        ├── stop.ts         # Stop LocalNet
        ├── status.ts       # Show container status
        ├── destroy.ts      # Remove containers/volumes
        ├── init.ts         # Initialize resources
        ├── parties.ts      # List parties
        ├── packages.ts     # List DAR packages
        ├── instances.ts    # List running LocalNet instances
        ├── entitlements.ts # List users with their rights
        └── discovery.ts    # Run the multi-instance discovery server

test/unit/              # Unit tests that do not require Docker
test/smoke/             # Cross-runtime smoke tests (node:* compat checks)
test/integration/       # Integration tests (require Docker)
```

## Key Concepts

### Super Validator (SV) vs Regular Validators

- **SV is IMPLICIT** - Always exactly 1, created automatically
  - Runs Global Synchronizer (Sequencer + Mediator)
  - Runs SV App, Scan App, and Validator App
  - Has web UIs for SV management, Scan, and SV Wallet
  - Ports at base (default 5000): 5000-5099

- **Regular Validators are CONFIGURABLE** - User specifies count or details
  - Each runs a Participant node and Validator App
  - Each has a Wallet web UI
  - Ports at base + (index * 100): 5100-5199 (v1), 5200-5299 (v2), etc.

### Container Architecture

A running LocalNet consists of these Docker containers:

| Container              | Purpose                    | Notes                                                           |
| ---------------------- | -------------------------- | --------------------------------------------------------------- |
| `postgres`             | Shared PostgreSQL database | All services share one instance                                 |
| `canton`               | Canton participant nodes   | Runs ALL participant nodes (SV + validators) in one process     |
| `splice`               | Splice apps                | Runs ALL app backends (SV, Scan, all Validators) in one process |
| `keycloak`             | OAuth2 identity provider   | Always started                                                  |
| `nginx`                | Reverse proxy              | Routes web UI traffic by hostname and port                      |
| `sv-web-ui`            | SV management UI           | Static React app served on container port 8080                  |
| `scan-web-ui`          | Network explorer UI        | Static React app served on container port 8080                  |
| `wallet-web-ui-sv`     | SV wallet UI               | Static React app served on container port 8080                  |
| `wallet-web-ui-{name}` | Validator wallet UI        | One per validator, container port 8080                          |

**Critical**: The `splice` container runs ALL validator backends in a single process. If ANY
validator backend fails to initialize, the entire splice process crashes, taking ALL API servers
offline (including SV and Scan). This means a bad config for one validator causes 502 errors on
every API route.

### Port Allocation

Ports use a configurable base (default 5000) with +100 increments per validator. See
`src/utils/ports.ts` for port suffixes:

| Suffix | Service         | SV (5000) | Validator 1 (5100) | Validator 2 (5200) |
| ------ | --------------- | --------- | ------------------ | ------------------ |
| `+0`   | HTTP Health     | 5000      | 5100               | 5200               |
| `+1`   | Ledger API      | 5001      | 5101               | 5201               |
| `+2`   | Admin API       | 5002      | 5102               | 5202               |
| `+3`   | Validator Admin | 5003      | 5103               | 5203               |
| `+61`  | gRPC            | 5061      | 5161               | 5261               |
| `+75`  | JSON API        | 5075      | 5175               | 5275               |
| `+80`  | Web UI (nginx)  | 5080      | 5180               | 5280               |
| `+82`  | Keycloak        | 5082      | —                  | —                  |

SV-internal ports (container-internal, not exposed on host):

- Sequencer Public: 5008
- Sequencer Admin: 5009
- Scan Admin: 5012
- SV Admin: 5014
- Mediator gRPC Health: 5063

### Nginx Reverse Proxy

Nginx routes web UI traffic using `server_name` matching on each port:

| Port | Hostname           | Routes to                                                               |
| ---- | ------------------ | ----------------------------------------------------------------------- |
| 5080 | `sv.localhost`     | sv-web-ui:8080 + `/api/sv` → splice:5014                                |
| 5080 | `scan.localhost`   | scan-web-ui:8080 + `/api/scan` → splice:5012, `/registry` → splice:5012 |
| 5080 | `wallet.localhost` | wallet-web-ui-sv:8080 + `/api/validator` → splice:5003                  |
| 5180 | `wallet.localhost` | wallet-web-ui-{v1}:8080 + `/api/validator` → splice:5103                |
| 5280 | `wallet.localhost` | wallet-web-ui-{v2}:8080 + `/api/validator` → splice:5203                |

Key nginx config rules (see `generateNginxConfigString` in `src/docker/nginx.ts`):

- Web UI `proxy_pass` uses direct hostname with trailing slash: `proxy_pass http://sv-web-ui:8080/;`
- API `proxy_pass` does NOT use trailing slash: `proxy_pass http://splice:5014/api/sv;`
- No `upstream` blocks — direct `proxy_pass` only
- No `default_server` catch-all — explicit `server_name` matching
- All validator blocks use `server_name wallet.localhost;`

### Party Hints and Canton Naming

Canton requires party hints to match the pattern `<organization>-<function>-<enumerator>` where
organization and function are alphanumeric (plus underscores) and enumerator is an integer.
Examples: `alice-validator-1`, `bob-party-0`, `localnet-validator1-1`.

**Two distinct party concepts:**

1. **Validator Party Hint** (`validator-party-hint` in splice config) — The validator operator's own
   party, created automatically by Splice during onboarding. Always derived from the validator name:
   `localnet-{sanitizedName}-{index}`. Never from user config.

2. **User Parties** (configured via `parties:` in YAML) — Application-level parties allocated later
   via the Ledger API during `initializeResources()`. User-provided hints that don't match the
   required pattern are normalized automatically by `normalizePartyHint()` (e.g., `alice` →
   `alice-party-0`).

The `normalizePartyHint()` function in `src/generator/splice.ts`:

- Validates against regex: `^[a-zA-Z0-9_]+-[a-zA-Z0-9_]+-[0-9]+$` (matches upstream Splice)
- If hint already matches, returns unchanged
- Otherwise: strips non-alphanumeric/underscore chars, appends `-party-0`

### User Rights and Entitlements

Canton Ledger API v2 supports 7 right types, split into two categories:

**Per-party rights** (require a party):

- `CanActAs` — Submit commands as this party
- `CanReadAs` — Read transactions for this party
- `CanExecuteAs` — Execute Daml choices as this party

**Participant-wide rights** (no party needed):

- `ParticipantAdmin` — Full admin access (list/create users, grant rights)
- `CanReadAsAnyParty` — Read transactions for any party
- `CanExecuteAsAnyParty` — Execute commands as any party
- `IdentityProviderAdmin` — Manage identity providers

**UserConfig shape** (`src/types/config.ts`):

```typescript
interface UserConfig {
  id: string;
  primaryParty?: string; // Optional — user always gets CanActAs on this party
  rights?: UserRight[]; // Participant-wide rights (also accepts per-party for backward compat)
  parties?: UserPartyConfig[]; // Additional per-party rights
  validator?: string;
}

interface UserPartyConfig {
  hint: string; // Party hint reference
  rights?: PerPartyRight[]; // Defaults to ['CanActAs'] if omitted
}
```

**Auto-allocation**: Parties referenced in `user.parties[].hint` or `user.primaryParty` that are NOT
in the validator's top-level `parties` list are automatically allocated during
`initializeResources()`.

**Initialization flow** (`src/localnet.ts:initializeResources()`):

1. Allocate top-level parties from each validator's `parties` config
2. Create each YAML-defined user via `LocalNet.createUser()` — this provisions the ledger user, the
   Keycloak user, AND onboards the wallet in one call. Auto-allocates any referenced parties not
   already present.

**ApiUserRight wire format** (`src/api/canton.ts`): The Canton Ledger API v2 uses a `value` wrapper
for all right types:

- Per-party: `{ kind: { CanActAs: { value: { party: "..." } } } }`
- Participant-wide: `{ kind: { ParticipantAdmin: { value: {} } } }`

Helper functions: `createCanActAs()`, `createCanReadAs()`, `createCanExecuteAs()`,
`createParticipantAdmin()`, `createCanReadAsAnyParty()`, `createCanExecuteAsAnyParty()`,
`createIdentityProviderAdmin()`

**Runtime user creation**: `LocalNet.createUser(userId, validatorName, options?)` provisions a user
end-to-end: ledger account on the validator's Participant node, Keycloak user in the validator's
realm (username = password), and wallet onboarding via the Validator Admin API. Party hints
referenced by `options.primaryParty` and `options.parties[].hint` are auto-allocated if they don't
already exist on the validator. Each side is idempotent — re-calling converges (ledger 409 = already
exists, Keycloak 409 = already exists, splice 409 = already onboarded). Not atomic — partial
failures are OK and retries converge.

### Configuration

Config can be a simple count or detailed array:

```yaml
# Simple — creates 2 validators with default names (validator-1, validator-2)
validators: 2

# Detailed — custom names and parties
validators:
  - name: alice-validator
    parties:
      - hint: alice
  - name: bob-validator

# Detailed — custom names, parties, and users with multi-party rights
validators:
  - name: alice
    parties:
      - hint: alice
    users:
      - id: alice-user
        primaryParty: alice
        parties:
          - hint: bob
            rights: [CanReadAs]
      - id: admin
        rights: [ParticipantAdmin]
```

### Auth Mode

OAuth2 with Keycloak is the only supported authentication mode.

- Uses RS-256 with JWKS URL for token validation
- Audience is always `https://canton.network.global` (hardcoded as `DEFAULT_AUDIENCE` — not
  user-configurable)
- Keycloak URL is derived from `basePort` via `getKeycloakUrl(config)` — not user-configurable
- Username = password for all default UI users (e.g., `sv`/`sv`, `validator-1`/`validator-1`)
- Keycloak at port basePort + 82 (default 5082)
- `auth.keycloak.admin`/`password` are the persistent Keycloak master realm admin credentials. A
  temporary bootstrap admin is created during startup and deleted after Keycloak is ready.

### Keycloak Realm Naming

Realm names are derived from validator names by title-casing each dash-separated segment:

- SV realm: always `SV`
- `validator-1` → `Validator1`
- `validator-2` → `Validator2`
- `alice-validator` → `AliceValidator`
- `app` → `App`

This logic exists in both `src/generator/keycloak.ts` (realm generation) and
`src/generator/splice.ts` (JWKS URL construction). They MUST agree — a mismatch causes 401
Unauthorized errors on the validator wallet APIs.

Default credentials (username = password):

| Realm      | URL                   | Username      | Purpose                              |
| ---------- | --------------------- | ------------- | ------------------------------------ |
| SV         | sv.localhost:5080     | `sv`          | SV management UI                     |
| SV         | scan.localhost:5080   | `sv`          | Scan explorer, if login is requested |
| SV         | wallet.localhost:5080 | `sv`          | SV wallet                            |
| Validator1 | wallet.localhost:5180 | `validator-1` | Validator 1 wallet                   |
| Validator2 | wallet.localhost:5280 | `validator-2` | Validator 2 wallet                   |

For custom validator names, the user gets a Keycloak user matching the validator name. Each
validator realm also includes an internal wallet admin user named
`${validator_name_with_underscores}-wallet-admin`; normal users should use the validator-name or
YAML-defined users instead.

### Discovery Server

The `discovery` YAML field is deprecated and kept only for backward compatibility. Starting a
LocalNet prints a warning when that field is present; it does not run a discovery server.

Run discovery explicitly when you need HTTP discovery across running LocalNet instances:

```bash
deno task cli discovery serve --port 3100 --host 127.0.0.1
```

The server exposes `/health`, `/instances`, and per-instance routes such as `/instances/:id/status`,
`/instances/:id/env`, `/instances/:id/parties`, `/instances/:id/packages`, and
`/instances/:id/snapshot`.

## Config Generation Pipeline

Understanding how configs flow from YAML to running containers:

```
localnet.yaml
    ↓ loadConfigFile() → LocalNetConfig
    ↓
┌───────────────────────────────────────┐
│ Generator Layer (src/generator/)       │
│                                        │
│ hocon.ts → Canton HOCON configs        │  → canton container
│ splice.ts → Splice app.conf            │  → splice container
│ keycloak.ts → Keycloak realm JSON      │  → keycloak container
│ env.ts → Environment variables         │  → all containers
└───────────────────────────────────────┘
    ↓
┌───────────────────────────────────────┐
│ Docker Layer (src/docker/, src/localnet.ts) │
│                                        │
│ docker/containers.ts → Container specs │
│ docker/nginx.ts → Nginx config string  │  → nginx container
│   (generateNginxConfigString)          │
│ localnet.ts → Orchestration lifecycle  │
└───────────────────────────────────────┘
```

Key files in the generation pipeline:

| File                        | Generates                                            | Used By                                    |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `src/generator/splice.ts`   | `app.conf` for splice container                      | Splice app backends (SV, Scan, Validators) |
| `src/generator/hocon.ts`    | Canton HOCON configs                                 | Canton participant nodes                   |
| `src/generator/keycloak.ts` | Keycloak realm JSON exports                          | Keycloak container (realm import)          |
| `src/generator/env.ts`      | Environment variable files                           | All containers                             |
| `src/docker/nginx.ts`       | Nginx config string (`generateNginxConfigString`)    | Nginx reverse proxy                        |
| `src/docker/containers.ts`  | Docker container specs (images, ports, volumes, env) | Docker API                                 |
| `src/localnet.ts`           | Lifecycle orchestration                              | All containers (start/stop/destroy)        |

## SDK Architecture

### Two Entry Points

The package exposes two main entry points via `deno.json` exports:

- **`src/mod.ts`** (export `"."`, import as `@denex/localnet`) ... Full barrel export of everything.
  Types, schemas, generators, Docker orchestration, API clients, utilities, plus the unified
  `LocalNet` class. For advanced or low-level use cases.
- **`src/sdk/mod.ts`** (export `"./sdk"`, import as `@denex/localnet/sdk`) ... Curated entry point
  re-exporting `LocalNet`, `LocalNetBuilder`, `createLocalNet`, and a handful of helpers. For
  typical consumers who just want to start a LocalNet and query its state.

Two additional exports exist for specific needs:

- `"./cli"` (`src/cli/mod.ts`) ... CLI entry point, Deno-only
- `"./types"` (`src/types/mod.ts`) ... Type-only exports

### Layered Architecture

```
Consumer code
    ↓
src/sdk/mod.ts (curated)
├── LocalNet (re-exported from ../localnet.ts)
├── LocalNetBuilder (builder.ts)   fluent config creation
├── createLocalNet() (re-exported) construct + start in one call
└── Re-exports: loadConfigFile, loadConfigFromString, createMinimalConfig,
                getCredentials, buildConfigEnvironmentInfo
    ↓
src/mod.ts (full surface)
├── LocalNet                       lifecycle + aggregated state queries
├── CantonClient                   Ledger API v2
├── ValidatorAdminClient           Validator Admin API
├── MultiInstanceDiscoveryServer   discovery HTTP server
└── generators, schemas, types, utils
```

`LocalNet` (from `src/localnet.ts`) is the single unified class. It owns container lifecycle
(`start`, `stop`, `destroy`, `restart`, `status`), per-validator API clients, and aggregated state
queries (`getParties`, `getUsers`, `getUsersWithRights`, `getPackages`, `getSnapshot`,
`getDsoPartyId`, etc.). State-query methods enforce a "Tier 3" guard via `requireRunning()` — they
throw if the LocalNet hasn't been started or attached.

Static factories drive the two normal entry points:

- `LocalNet.fromConfig(yamlPathOrConfig, options?)` ... build from a YAML path or config object
  (call `start()` after).
- `LocalNet.fromInstanceId(id, options?)` ... attach to a running instance, reading config back from
  the `denex.localnet.config` Docker label (schema=2). Useful for state-2 commands.
- `LocalNet.discover(options?)` ... list running instances on the host.
- `createLocalNet(config, options?)` ... convenience that constructs and immediately calls
  `start()`.

`LocalNetBuilder` provides a fluent API for building configs in code. It converts `ValidatorSpec`
objects into `ValidatorConfig` format, then passes through Zod validation via `withDefaults()`. If
no validators are configured, it defaults to 2.

### Cross-Runtime Architecture

The codebase is split into cross-runtime and Deno-only layers:

**Cross-runtime** (`src/`, excluding `src/cli/`):

- Uses `node:` builtins throughout: `node:fs/promises`, `node:net`, `node:http`, `node:path`,
  `node:process`
- Works on Deno 2.0+, Node.js 18+, and Bun
- YAML parsing via `npm:yaml` (the `yaml` npm package)
- HTTP server: `node:http` `createServer()` with Hono's `app.fetch()` (in `src/api/discovery.ts`)
- TCP health checks: `node:net` `createConnection()` (in `src/docker/health.ts`)
- File I/O: `node:fs/promises` (in `localnet.ts`, `yaml.ts`, `canton.ts`)

**Deno-only** (`src/cli/`):

- Uses `Deno.exit()`, `@cliffy/*` for CLI framework, `@std/yaml` for YAML parsing
- Not intended for cross-runtime use

**Bun limitation**: Docker Unix sockets don't work on Bun because of a broken `socketPath`
implementation in Bun's `node:http`. If running on Bun, Docker must be configured to listen on a TCP
socket instead.

The smoke test at `test/smoke/node-compat.mjs` verifies that no `Deno.*` APIs or `@std/*` imports
leak into the cross-runtime source. It also checks that all `node:*` imports resolve and that the
builder and `LocalNet` class work correctly.

## Working with This Codebase

### Running Commands

```bash
# Run tests
deno test --allow-all

# Type check
deno check src/mod.ts

# Run CLI
deno run --allow-all src/cli/mod.ts --help
deno run --allow-all src/cli/mod.ts start
deno run --allow-all src/cli/mod.ts status
```

```bash
deno task cli start
deno task cli status
deno task cli stop
```

### CLI Commands Reference

| Command        | Description                                  |
| -------------- | -------------------------------------------- |
| `start`        | Start LocalNet containers                    |
| `stop`         | Stop all containers gracefully               |
| `status`       | Show health and container states             |
| `destroy`      | Remove containers, networks, volumes         |
| `init`         | Initialize resources on running LocalNet     |
| `config`       | Generate localnet.yaml interactively         |
| `parties`      | List parties across validators               |
| `packages`     | List uploaded DAR packages                   |
| `env`          | Show API URLs, auth config, DSO party ID     |
| `credentials`  | Show web UI login credentials                |
| `instances`    | List running LocalNet instances              |
| `entitlements` | List users with their rights                 |
| `discovery`    | Run the multi-instance discovery HTTP server |

State-2 commands (`stop`, `status`, `destroy`, `init`, `parties`, `packages`, `env`, `credentials`,
`entitlements`) no longer accept `--config`. They auto-discover the config from Docker labels via
`--instance <id>`, or auto-resolve when only one instance is running. Only `start` and `config`
accept `--config <path>`.

### Key Files to Understand

| File                               | Purpose                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/localnet.ts`                  | Unified `LocalNet` class — lifecycle, state queries, static factories (`fromConfig`, `fromInstanceId`, `discover`), `createLocalNet` factory |
| `src/sdk/mod.ts`                   | Curated SDK entry point, re-exports `LocalNet` and helpers                                                                                   |
| `src/sdk/builder.ts`               | `LocalNetBuilder` fluent config builder                                                                                                      |
| `src/sdk/types.ts`                 | SDK-specific types (`ValidatorSpec`, `UserSpec`, `LocalNetBuilderConfig`)                                                                    |
| `src/types/config.ts`              | Core configuration types, `DEFAULT_AUDIENCE`, `getKeycloakUrl()`, `normalizeValidators()`                                                    |
| `src/docker/containers.ts`         | Container spec builders for all services                                                                                                     |
| `src/docker/nginx.ts`              | `generateNginxConfigString` — nginx config generation                                                                                        |
| `src/generator/splice.ts`          | Splice app.conf generation, `normalizePartyHint()`, validator-party-hint derivation                                                          |
| `src/generator/keycloak.ts`        | Keycloak realm/client/scope generation, realm naming                                                                                         |
| `src/generator/hocon.ts`           | Canton HOCON config generation                                                                                                               |
| `src/api/state-types.ts`           | Wire-level state types (`ApiPartyInfo`, `ApiUserInfo`, etc.)                                                                                 |
| `src/api/keycloak-admin.ts`        | `KeycloakAdminClient` for runtime Keycloak user provisioning                                                                                 |
| `src/api/discovery.ts`             | `MultiInstanceDiscoveryServer` HTTP server                                                                                                   |
| `src/api/discovery-utils.ts`       | `discoverInstances`, label parsing, schema=2 helpers                                                                                         |
| `src/utils/ports.ts`               | Port allocation logic, `getSvPorts()`, `getValidatorPorts()`, `getKeycloakPort()`                                                            |
| `src/utils/credentials.ts`         | `getCredentials()` and `CredentialInfo` (relocated from CLI layer)                                                                           |
| `src/cli/mod.ts`                   | CLI entry point and command registration                                                                                                     |
| `src/cli/commands/entitlements.ts` | Entitlements CLI command, `formatRight()` display logic                                                                                      |

### Common Patterns

**High-level SDK (recommended for most use cases):**

```typescript
import { LocalNet, LocalNetBuilder } from '@denex/localnet/sdk';

// From YAML file
const net = await LocalNet.fromConfig('./localnet.yaml');
await net.start();
const creds = await net.getCredentials();
const env = await net.getEnvironment();
await net.destroy();

// Programmatic builder
const config = LocalNetBuilder.create()
  .addValidator('alice', { parties: ['alice'] })
  .addValidator('bob')
  .withBasePort(6000)
  .build();
const net2 = await LocalNet.fromConfig(config);
await net2.start();
```

**Loading config (low-level):**

```typescript
import { loadConfigFile, loadConfigFromDir } from '@denex/localnet';
const config = await loadConfigFile('./localnet.yaml');
// or auto-find in current directory:
const config = await loadConfigFromDir();
```

**Creating LocalNet (low-level):**

```typescript
import { LocalNet } from '@denex/localnet';
const localnet = new LocalNet(config, { instanceId: 'test-1' });
await localnet.start();
```

**Using API clients (low-level):**

```typescript
import { LocalNet } from '@denex/localnet';

// Attach to a running instance for state queries
const localnet = await LocalNet.fromInstanceId('test-1');
const parties = await localnet.getParties();

// Get validator party ID
const partyId = await localnet.getValidatorPartyId('validator-1');

// Get DSO party ID
const dsoPartyId = await localnet.getDsoPartyId();

// Create user (full lifecycle: ledger + Keycloak + wallet)
await localnet.createUser('alice', 'validator-1', {
  primaryParty: 'alice',
  parties: [{ hint: 'bob', rights: ['CanReadAs'] }],
});

// Get users with their rights (entitlements)
const usersWithRights = await localnet.getUsersWithRights('validator-1');
```

**Initialization:** The `LocalNet.start()` method automatically initializes resources (creates
users, links parties) unless `skipInitialization` is set. You can also run initialization manually:

```typescript
await localnet.initializeResources();
```

### Type Naming Conventions

Types with `Api` prefix are wire-level types from Canton APIs:

- `ApiPartyInfo`, `ApiUserInfo`, `ApiPackageInfo` - from `src/api/state-types.ts`
- `PartyDetails`, `UserDetails`, `PackageDetails` - from `src/api/canton.ts`

Types without prefix are SDK-level abstractions:

- `PartyInfo`, `UserInfo`, `PackageInfo` - from `src/types/state.ts`
- `LocalNetConfig`, `ValidatorConfig` - from `src/types/config.ts`
- `ApiUserInfoWithRights` - from `src/api/state-types.ts` (extends ApiUserInfo with rights)

SDK types (from `src/sdk/types.ts`):

- `ValidatorSpec` - simplified validator definition for the builder (name, parties as strings,
  users)
- `UserSpec` - simplified user definition for the builder (id, primaryParty, rights)
- `LocalNetBuilderConfig` - internal builder state (not part of public API)

Lifecycle/construction options live in `src/localnet.ts`:

- `LocalNetOptions` - constructor options for `LocalNet` (instanceId, labelPrefix, configDir,
  dataDir, images, dbUser, dbPassword)
- `StartOptions` - per-call options for `LocalNet.start()` (timeout, parallel, skipHealthChecks,
  skipInitialization, onProgress) — defined in `src/docker/types.ts`

## Debugging & Troubleshooting

### Common Issues

**502 Bad Gateway on all API routes:** The splice container is likely crash-looping. Check with:

```bash
docker inspect splice --format '{{.RestartCount}}'
docker logs splice 2>&1 | grep -iE "fatal|exception|error|INVALID_ARGUMENT"
```

Common cause: invalid party hints that don't match `<org>-<function>-<enumerator>` pattern. The
`normalizePartyHint()` function should handle this, but check for edge cases.

**401 Unauthorized on validator wallet APIs:** The Keycloak realm name in the splice config doesn't
match the actual Keycloak realm. The JWKS URL must point to the correct realm. Check that
`src/generator/splice.ts` and `src/generator/keycloak.ts` derive realm names using the same logic
(title-case each dash-separated segment of validator name).

**Web UI loads but shows infinite loading spinner:** The UI loaded (nginx routing works) but the API
backend is unreachable or returning errors. Check:

```bash
# Test API from host
curl -sv http://wallet.localhost:5180/api/validator/v0/wallet/user-status

# Test from inside nginx
docker exec nginx curl -sv http://splice:5103/api/validator/v0/wallet/user-status
```

**Scan UI works but SV/wallet don't:** Scan UI handles API failures gracefully (shows loading/empty
state). SV and wallet UIs show error pages. If scan "works" but others don't, ALL APIs are likely
down — scan just hides it better.

**Splice crash-loops with "Node name is too long":** Splice enforces a 30-character max for node
names. The node name format is `${participantName}-validator_backend` where `participantName` =
validator name with `-` replaced by `_`. The suffix is 19 chars, so the validator name must produce
≤ 11 chars after underscore conversion.

```bash
# Check the error
docker logs splice 2>&1 | grep "Node name is too long"
```

Fix: Use shorter validator names. Examples: `val1` (ok), `alice` (ok), `alice-validator` (too long →
33 chars).

### Diagnostic Commands

```bash
# Check container health
deno task cli status

# Check splice restart count (should be 0)
docker inspect splice --format '{{.RestartCount}}'

# Check splice logs for errors
docker logs splice 2>&1 | grep -iE "fatal|exception|error|INVALID_ARGUMENT" | tail -20

# Test nginx routing from inside the container
docker exec nginx curl -sv http://splice:5014/api/sv
docker exec nginx curl -sv http://sv-web-ui:8080/

# Check deployed nginx config
docker exec nginx cat /etc/nginx/nginx.conf

# Check DNS resolution inside nginx
docker exec nginx nslookup splice
docker exec nginx nslookup sv-web-ui

# Test Keycloak realm availability
curl -s http://localhost:5082/realms/SV/.well-known/openid-configuration | head -5
curl -s http://localhost:5082/realms/Validator1/.well-known/openid-configuration | head -5

# Get a token from Keycloak (test auth — client credentials)
curl -s -X POST http://localhost:5082/realms/SV/protocol/openid-connect/token \
  -d "grant_type=client_credentials&client_id=sv-validator&client_secret=sv-validator-secret"
```

## External Resources

### Canton Documentation

- Network docs: https://docs.sync.global/
- Daml reference: https://docs.digitalasset.com/build/3.4/index.html
- Daml Script: https://docs.daml.com/daml-script/index.html
- Participant/Validator Ledger API:
  https://docs.digitalasset.com/build/3.4/explanations/ledger-api.html
- JSON Ledger API OpenAPI Spec:
  https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html#reference-json-api-openapi

### Reference Implementations

These upstream projects are useful references, but they are not vendored or configured as submodules
in this repository.

- **Splice**: https://github.com/canton-network/splice
  - LocalNet setup: `cluster/compose/localnet`
  - Reference nginx configs: `cluster/compose/localnet/conf/nginx/sv.conf`,
    `cluster/compose/validator/nginx.conf`
  - Validator app source: `apps/validator/src/main/scala/org/lfdecentralizedtrust/splice/validator/`
  - Build tools: `build-tools/splice-localnet-compose.sh`
- **Canton Network Quickstart**: https://github.com/digital-asset/cn-quickstart
  - Docs: https://docs.digitalasset.com/build/3.4/quickstart/

If you need local source references during development, clone them under `.references/` so they stay
outside version control:

```bash
mkdir -p .references
git clone https://github.com/canton-network/splice .references/splice
git clone https://github.com/digital-asset/cn-quickstart .references/cn-quickstart
```

The `.references/` directory is ignored by `.gitignore`.

### Research Docs

The `docs/research/` folder contains prior research. These docs describe the problem space but may
have outdated implementation details, including references to upstream repositories that used to be
checked out locally. Use them to understand Canton concepts, not as implementation specs.

## Testing

Tests are organized in two categories:

### Unit Tests (`test/unit/`)

Fast tests that don't require Docker. Run with:

```bash
deno test --allow-all test/unit/
```

Coverage includes:

- `config_test.ts` - Config parsing and validation
- `generator_test.ts` - HOCON, Splice, env, Keycloak generation, party hint normalization,
  validator-party-hint derivation
- `docker_test.ts` - Container building, health checks, nginx config content verification
- `api_test.ts` - API clients and state manager
- `cli_test.ts` - CLI utilities
- `sdk_test.ts` - LocalNetBuilder, LocalNet static factories, createLocalNet factory, SDK exports

### Integration Tests (`test/integration/`)

Tests that require a running Docker daemon. Run with:

```bash
deno test --allow-all test/integration/
```

Coverage:

- `docker_client_test.ts` - Docker API operations (ping, pull, create, start, stop, list)
- `postgres_test.ts` - PostgreSQL container startup and health checks
- `network_test.ts` - Docker network creation and container connectivity
- `localnet_test.ts` - Full LocalNet lifecycle (start, status, stop, destroy, restart)
- `initialization_test.ts` - Party allocation, user creation, wallet onboarding
- `entitlements_test.ts` - User rights verification, multi-party rights, auto-allocation, admin
  operations

Integration tests:

- Auto-skip if Docker is unavailable
- Use unique instance IDs to avoid conflicts
- Clean up all resources after each test
- Use `skipHealthChecks: true` for faster execution when testing lifecycle

### Running All Tests

```bash
deno test --allow-all test/
```

## Future Work / TODOs

Potential areas for enhancement:

- DAR package upload on startup from config
- Daml Script integration
- Web UI / dashboard
- Discovery server packaging/operational model beyond the current foreground CLI server
- Config validation for validator name length (Splice 30-char node name limit)
- `dnt` build scripts for npm publishing
- JSR publishing setup
