# Better Canton LocalNet Tools - Implementation Plan

> [!WARNING]
> Historical planning document. It is useful for original intent and rationale, but it is not a
> current implementation spec. Prefer `AGENTS.md`, `agents/INDEX.md`, and source files for current
> behavior.

> Comprehensive plan for building a Testcontainers-style SDK for Canton Network LocalNets

**Version:** 1.1  
**Date:** January 2026  
**Status:** Implementation Started

---

## Key Design Decisions (Updated)

1. **Orchestration**: Direct Docker API (via Dockerode), NOT Docker Compose files
   - Full programmatic control over individual containers
   - No YAML templating - just code
   - Exactly how Testcontainers works internally
   - Can export Compose files later if users want them

2. **Topology Model**:
   - **Super Validator (SV)**: IMPLICIT required infrastructure - always exactly 1, not user-configurable
   - **Regular Validators**: CONFIGURABLE - users specify count (1-N), default 2
   - SV runs: Participant + Sequencer + Mediator + SV App + Scan App + Validator App
   - Validators run: Participant + Validator App only

3. **No Kubernetes**: Docker only for now
   - K8s adds 20-55s startup overhead vs 2-5s for Docker
   - Helm charts exist but are for production, not local dev
   - Can add K8s support later if users request it

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Phase 1: Foundation](#3-phase-1-foundation)
4. [Phase 2: Configuration Generation](#4-phase-2-configuration-generation)
5. [Phase 3: Container Orchestration](#5-phase-3-container-orchestration)
6. [Phase 4: State Management & Discovery](#6-phase-4-state-management--discovery)
7. [Phase 5: CLI Tool](#7-phase-5-cli-tool)
8. [Phase 6: SDK & Testcontainers API](#8-phase-6-sdk--testcontainers-api)
9. [Phase 7: Integration & Testing](#9-phase-7-integration--testing)
10. [Risk Analysis](#10-risk-analysis)
11. [Success Criteria](#11-success-criteria)
12. [Appendix: Technical Reference](#12-appendix-technical-reference)

---

## 1. Executive Summary

### Goal

Create a TypeScript-based SDK and CLI tool that provides Testcontainers-style programmatic control over Canton Network LocalNets, replacing the current 100+ configuration file approach with a simple, declarative API.

### Key Deliverables

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| **TypeScript SDK** | Testcontainers-style API for programmatic LocalNet control | P0 |
| **CLI Tool** | Command-line interface for manual operations | P0 |
| **Configuration Generator** | Generate HOCON/env files from simple spec | P0 |
| **Discovery API** | HTTP server for runtime party/package/state queries | P1 |
| **Container Orchestration** | Manage Docker containers with health checks | P0 |

### Timeline Estimate

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 1: Foundation | 2-3 days | 2-3 days |
| Phase 2: Configuration Generation | 3-4 days | 5-7 days |
| Phase 3: Container Orchestration | 4-5 days | 9-12 days |
| Phase 4: State Management | 3-4 days | 12-16 days |
| Phase 5: CLI Tool | 2-3 days | 14-19 days |
| Phase 6: SDK API | 3-4 days | 17-23 days |
| Phase 7: Integration | 2-3 days | 19-26 days |

**Total: ~4-5 weeks** for full implementation

---

## 2. Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           User-Facing Interfaces                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐ │
│  │   TypeScript SDK    │    │     CLI Tool        │    │  Discovery API   │ │
│  │                     │    │                     │    │   (HTTP/REST)    │ │
│  │  localnet.start()   │    │  localnet start     │    │  GET /parties    │ │
│  │  localnet.stop()    │    │  localnet status    │    │  GET /packages   │ │
│  │  localnet.parties() │    │  localnet parties   │    │  GET /env        │ │
│  └─────────┬───────────┘    └──────────┬──────────┘    └────────┬─────────┘ │
│            │                           │                        │           │
└────────────┼───────────────────────────┼────────────────────────┼───────────┘
             │                           │                        │
             ▼                           ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Core Services                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        LocalNet Manager                              │    │
│  │  - Orchestrates all components                                       │    │
│  │  - Manages lifecycle (start/stop/destroy)                            │    │
│  │  - Coordinates configuration and discovery                           │    │
│  └───────────────────────────────┬─────────────────────────────────────┘    │
│                                  │                                           │
│  ┌───────────────┐  ┌────────────┴────────────┐  ┌───────────────────────┐  │
│  │ Configuration │  │  Container Orchestrator  │  │   State Manager       │  │
│  │   Generator   │  │                          │  │                       │  │
│  │               │  │  - Docker API wrapper    │  │  - Party discovery    │  │
│  │  Spec → HOCON │  │  - Health monitoring     │  │  - Package tracking   │  │
│  │  Spec → .env  │  │  - Network management    │  │  - User management    │  │
│  │  Spec → Realm │  │  - Dependency ordering   │  │  - Cache layer        │  │
│  └───────────────┘  └─────────────────────────┘  └───────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
             │                           │                        │
             ▼                           ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Infrastructure Layer                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        Canton API Client                             │    │
│  │  - JSON Ledger API v2 wrapper                                        │    │
│  │  - OAuth2 token management                                           │    │
│  │  - Party/User/Package operations                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        Docker Containers                             │    │
│  │                                                                      │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │    │
│  │  │ postgres │  │  canton  │  │  splice  │  │ keycloak │             │    │
│  │  │   :5432  │  │ :X9XX    │  │ :X9XX    │  │  :8082   │             │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘             │    │
│  │                                                                      │    │
│  │  + nginx, wallet-web-ui, ans-web-ui, scan-web-ui, sv-web-ui         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Deno 2.x | Modern TypeScript runtime, great DX |
| Language | TypeScript | Type safety, existing ecosystem |
| CLI Framework | Cliffy | Deno-native, full-featured CLI |
| HTTP Server | Hono | Fast, lightweight, works with Deno |
| Validation | Zod | Type inference, excellent DX |
| Config Format | YAML (input) → HOCON/JSON (output) | Human-readable input, machine-readable output |
| Docker | Docker API via Dockerode | Direct container control (NOT Compose) |
| Testing | Deno standard library | Built-in test runner |

**Why Docker API directly (not Docker Compose)?**
- Full programmatic control over individual containers
- Dynamic configuration without YAML templating
- Better error handling and logging per container
- Can start/stop/inspect individual containers
- Export Compose files as a feature, not a dependency

### Project Structure

```
mg-localnet/
├── splice/                      # Submodule: hyperledger-labs/splice
├── cn-quickstart/               # Submodule: digital-asset/cn-quickstart
├── docs/
│   ├── research/                # Existing research documents
│   └── plans/                   # This plan
├── src/
│   ├── mod.ts                   # Main entry point (SDK exports)
│   ├── types/
│   │   ├── config.ts            # Configuration types
│   │   ├── state.ts             # State/runtime types
│   │   └── api.ts               # API response types
│   ├── schemas/
│   │   ├── localnet-config.ts   # Zod schema for localnet.yaml
│   │   ├── hocon.ts             # HOCON generation schemas
│   │   └── keycloak-realm.ts    # Keycloak realm schemas
│   ├── generator/
│   │   ├── mod.ts               # Generator exports
│   │   ├── hocon.ts             # HOCON config generation
│   │   ├── env.ts               # Environment file generation
│   │   ├── keycloak.ts          # Keycloak realm generation
│   │   └── compose.ts           # Docker Compose override generation
│   ├── orchestrator/
│   │   ├── mod.ts               # Orchestrator exports
│   │   ├── docker.ts            # Docker API wrapper
│   │   ├── network.ts           # Network management
│   │   ├── health.ts            # Health check logic
│   │   └── containers/
│   │       ├── postgres.ts      # PostgreSQL container
│   │       ├── canton.ts        # Canton container
│   │       ├── splice.ts        # Splice container
│   │       └── keycloak.ts      # Keycloak container
│   ├── canton-client/
│   │   ├── mod.ts               # Canton API client exports
│   │   ├── client.ts            # HTTP client wrapper
│   │   ├── auth.ts              # OAuth2 token management
│   │   ├── parties.ts           # Party operations
│   │   ├── users.ts             # User operations
│   │   └── packages.ts          # Package (DAR) operations
│   ├── state/
│   │   ├── mod.ts               # State manager exports
│   │   ├── manager.ts           # State manager implementation
│   │   ├── discovery.ts         # Party/package discovery
│   │   └── cache.ts             # Caching layer
│   ├── discovery-server/
│   │   ├── mod.ts               # Discovery server exports
│   │   ├── server.ts            # Hono HTTP server
│   │   └── routes.ts            # API route definitions
│   ├── cli/
│   │   ├── mod.ts               # CLI entry point
│   │   └── commands/
│   │       ├── start.ts
│   │       ├── stop.ts
│   │       ├── status.ts
│   │       ├── parties.ts
│   │       ├── packages.ts
│   │       ├── env.ts
│   │       ├── generate.ts
│   │       └── serve.ts
│   ├── sdk/
│   │   ├── mod.ts               # SDK exports
│   │   ├── localnet.ts          # Main LocalNet class
│   │   ├── started-localnet.ts  # Started LocalNet (runtime API)
│   │   └── builder.ts           # Fluent builder API
│   └── utils/
│       ├── yaml.ts              # YAML parsing
│       ├── hocon.ts             # HOCON generation utilities
│       ├── ports.ts             # Port allocation
│       └── logging.ts           # Logging utilities
├── templates/
│   ├── hocon/
│   │   ├── canton-base.conf.tmpl
│   │   ├── canton-participant.conf.tmpl
│   │   ├── splice-validator.conf.tmpl
│   │   └── splice-sv.conf.tmpl
│   ├── env/
│   │   └── common.env.tmpl
│   └── keycloak/
│       └── realm.json.tmpl
├── test/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── examples/
│   ├── minimal/
│   ├── two-validators/
│   └── full-stack/
├── deno.json
├── deno.lock
├── localnet.yaml                # Example configuration
└── README.md
```

---

## 3. Phase 1: Foundation

### Objective

Set up the project infrastructure, define core types, and implement configuration schema validation.

### Tasks

#### 1.1 Project Setup
**Priority:** P0  
**Effort:** 0.5 days

- [ ] Initialize Deno project with `deno.json`
- [ ] Configure TypeScript settings
- [ ] Set up linting and formatting (deno lint, deno fmt)
- [ ] Create directory structure
- [ ] Add git hooks for pre-commit checks
- [ ] Configure VSCode settings for Deno

**Definition of Done:**
- `deno check src/mod.ts` passes
- `deno lint` passes
- `deno fmt --check` passes
- Project structure matches plan

#### 1.2 Core Type Definitions
**Priority:** P0  
**Effort:** 1 day

- [ ] Define `LocalNetConfig` interface (high-level configuration)
- [ ] Define `ValidatorConfig` interface
- [ ] Define `ParticipantConfig` interface  
- [ ] Define `PartyConfig` and `UserConfig` interfaces
- [ ] Define `AuthConfig` (OAuth2 and shared-secret modes)
- [ ] Define `PackageConfig` for DAR management
- [ ] Define runtime state types (`PartyInfo`, `PackageInfo`, `UserInfo`)
- [ ] Define API response types

**Key Types:**

```typescript
// src/types/config.ts

/**
 * Main configuration for a LocalNet.
 * 
 * NOTE: Super Validator (SV) is IMPLICIT - always exactly one is created.
 * The SV runs the Global Synchronizer (Sequencer + Mediator) that all
 * Validators connect to. Users only configure the regular Validators.
 */
export interface LocalNetConfig {
  /** Number of regular Validators OR detailed configs. SV is always added automatically. */
  validators: number | ValidatorConfig[];
  auth: AuthConfig;
  packages?: PackageConfig[];
  discovery?: DiscoveryConfig;
}

/**
 * Configuration for a regular Validator.
 * Note: This is NOT for the SV - the SV is created automatically with fixed config.
 */
export interface ValidatorConfig {
  name: string;
  parties?: PartyConfig[];
  users?: UserConfig[];
}

export interface PartyConfig {
  hint: string;
  displayName?: string;
  /** Which validator hosts this party. Defaults to first validator. */
  validator?: string;
}

export interface UserConfig {
  id: string;
  primaryParty: string;  // Reference to party hint
  rights: ('ParticipantAdmin' | 'CanActAs' | 'CanReadAs')[];
  /** Which validator this user belongs to. Defaults to same as primaryParty. */
  validator?: string;
}
```

**Definition of Done:**
- All types defined with JSDoc documentation
- Types exported from `src/types/mod.ts`
- Types compile without errors

#### 1.3 Configuration Schema (Zod)
**Priority:** P0  
**Effort:** 0.5 days

- [ ] Create Zod schema for `localnet.yaml` configuration
- [ ] Implement validation with helpful error messages
- [ ] Add default value handling
- [ ] Create schema for minimal configuration (sensible defaults)
- [ ] Add JSON Schema export for IDE support

**Definition of Done:**
- Schema validates example configurations correctly
- Invalid configurations produce clear error messages
- Defaults are applied correctly

#### 1.4 YAML Configuration Loader
**Priority:** P0  
**Effort:** 0.5 days

- [ ] Implement YAML file loading with `@std/yaml`
- [ ] Add environment variable expansion (`${VAR}` syntax)
- [ ] Implement configuration merging (defaults + user config)
- [ ] Add configuration file discovery (localnet.yaml, .localnet.yaml)
- [ ] Handle missing optional fields gracefully

**Definition of Done:**
- Can load and parse example `localnet.yaml`
- Environment variables are expanded
- Missing optional fields use defaults
- Clear error messages for invalid YAML

### Phase 1 Deliverables

- Working project structure
- Type system foundation
- Configuration loading and validation
- Example `localnet.yaml` file

### Dependencies

None (foundational phase)

---

## 4. Phase 2: Configuration Generation

### Objective

Generate all required configuration files (HOCON, .env, Keycloak realms) from the high-level `localnet.yaml` specification.

### Tasks

#### 2.1 HOCON Template System
**Priority:** P0  
**Effort:** 1 day

- [ ] Create HOCON template format with variable placeholders
- [ ] Implement template loading from `templates/hocon/`
- [ ] Build HOCON string generator (proper escaping, nesting)
- [ ] Support template inheritance (base config + overrides)
- [ ] Handle Canton-specific HOCON patterns (`${_participant}`, etc.)

**Template Example:**

```hocon
# templates/hocon/canton-participant.conf.tmpl
canton.participants.{{name}} = ${_participant} {
  storage.config.properties.databaseName = "participant_{{name}}"
  ledger-api.port = {{ledgerApiPort}}
  admin-api.port = {{adminApiPort}}
}
```

**Definition of Done:**
- Templates render correctly with variables
- Generated HOCON is valid and parseable
- Complex nesting and escaping works correctly

#### 2.2 Canton Configuration Generator
**Priority:** P0  
**Effort:** 1.5 days

- [ ] Generate base Canton configuration from templates
- [ ] Generate participant configurations (one per validator)
- [ ] Generate sequencer configuration (SV only)
- [ ] Generate mediator configuration (SV only)
- [ ] Configure storage (PostgreSQL connection per component)
- [ ] Configure API ports using prefix scheme (2xxx, 3xxx, 4xxx)
- [ ] Configure auth (JWT validation settings)
- [ ] Support N validators (not hardcoded to 3)

**Port Allocation Logic:**

```typescript
/**
 * Port prefix allocation:
 * - SV (Super Validator): Always 4xxx (fixed, implicit)
 * - Validator 0: 2xxx
 * - Validator 1: 3xxx
 * - Validator 2+: 5xxx, 6xxx, 7xxx, etc. (skip 4, reserved for SV)
 */
function getValidatorPortPrefix(validatorIndex: number): number {
  if (validatorIndex < 2) {
    return 2 + validatorIndex;  // 0→2, 1→3
  }
  return 3 + validatorIndex;    // 2→5, 3→6, etc. (skip 4)
}

const SV_PORT_PREFIX = 4;  // Always fixed

// Example with 2 validators:
// - SV: 4xxx (Sequencer: 5008, 5009; Mediator: 5007; Scan: 5012)
// - Validator 0: 2xxx (Ledger: 2901, Admin: 2902, JSON: 2975, ValidatorAdmin: 2903)
// - Validator 1: 3xxx (Ledger: 3901, Admin: 3902, JSON: 3975, ValidatorAdmin: 3903)
```

**Definition of Done:**
- Generates valid Canton HOCON for N validators
- Port allocation follows scheme correctly
- Database names are unique per component
- Auth configuration works with OAuth2

#### 2.3 Splice Configuration Generator
**Priority:** P0  
**Effort:** 1 day

- [ ] Generate validator backend configurations
- [ ] Generate SV app configuration (for super validator)
- [ ] Generate Scan app configuration
- [ ] Configure onboarding secrets
- [ ] Configure traffic settings
- [ ] Align ports with Canton configuration

**Definition of Done:**
- Generates valid Splice HOCON for N validators
- Validators connect to correct Canton participants
- SV-specific apps (scan, sv) configured correctly

#### 2.4 Environment File Generator
**Priority:** P0  
**Effort:** 0.5 days

- [ ] Generate merged environment file for Docker Compose
- [ ] Include profile configuration (which validators enabled)
- [ ] Include port mappings
- [ ] Include database configuration
- [ ] Include auth mode configuration
- [ ] Support variable layering (common + validator-specific)

**Definition of Done:**
- Single `.env` file contains all required variables
- Docker Compose can consume the file
- All ports and profiles correctly configured

#### 2.5 Keycloak Realm Generator
**Priority:** P1  
**Effort:** 1 day

- [ ] Generate minimal realm JSON (not 2300-line exports)
- [ ] Generate client configurations (service accounts, public clients)
- [ ] Generate required client scopes (audience mapper)
- [ ] Support multiple realms (one per validator type)
- [ ] Generate user configurations if specified

**Minimal Realm Structure:**

```typescript
interface MinimalRealm {
  realm: string;
  enabled: boolean;
  sslRequired: "none";
  clients: MinimalClient[];
  clientScopes: ClientScope[];
}
```

**Definition of Done:**
- Generated realm JSON is ~50-100 lines (not 2300+)
- Keycloak imports realm successfully
- Clients can obtain tokens
- Audience mapper configured correctly

#### 2.6 Docker Compose Override Generator
**Priority:** P2  
**Effort:** 0.5 days

- [ ] Generate `docker-compose.override.yaml` for profile overrides
- [ ] Disable unused services
- [ ] Configure volume mounts for generated configs
- [ ] Set resource constraints if specified

**Definition of Done:**
- Override file applies correctly to base compose
- Disabled services don't start
- Custom configs are mounted

### Phase 2 Deliverables

- HOCON configuration generator
- Environment file generator
- Keycloak realm generator
- Docker Compose override generator
- Generated output directory (`.localnet/generated/`)

### Dependencies

- Phase 1 (types and configuration loading)

---

## 5. Phase 3: Container Orchestration

### Objective

Manage Docker containers with proper lifecycle control, health checking, and dependency ordering.

### Tasks

#### 3.1 Docker API Client
**Priority:** P0  
**Effort:** 1 day

- [ ] Create Docker API wrapper using Dockerode or fetch
- [ ] Implement container lifecycle methods (create, start, stop, remove)
- [ ] Implement network management (create, connect, remove)
- [ ] Implement volume management
- [ ] Add container inspection and log streaming
- [ ] Handle Docker daemon connection errors gracefully

**Definition of Done:**
- Can create, start, stop, and remove containers
- Can create and manage Docker networks
- Graceful error handling for Docker issues

#### 3.2 Container Definitions
**Priority:** P0  
**Effort:** 1.5 days

- [ ] Define PostgreSQL container configuration
- [ ] Define Canton container configuration
- [ ] Define Splice container configuration
- [ ] Define Keycloak container configuration
- [ ] Define Nginx container configuration
- [ ] Define Web UI containers (wallet, ans, scan, sv)
- [ ] Configure environment variables from generated configs
- [ ] Configure volume mounts for configs and data

**Container Interface:**

```typescript
interface ContainerConfig {
  name: string;
  image: string;
  environment: Record<string, string>;
  ports: PortBinding[];
  volumes: VolumeMount[];
  networks: string[];
  healthCheck?: HealthCheckConfig;
  dependsOn?: string[];
}
```

**Definition of Done:**
- All container types defined with correct images
- Environment variables configured per container
- Port mappings follow the prefix scheme
- Volume mounts for configs work correctly

#### 3.3 Health Check Implementation
**Priority:** P0  
**Effort:** 1 day

- [ ] Implement HTTP health checks (`/health`, `/readyz`)
- [ ] Implement gRPC health checks (Canton participants)
- [ ] Implement TCP port checks
- [ ] Add configurable retry logic with backoff
- [ ] Implement composite health checks (all checks must pass)
- [ ] Add health check timeout handling

**Health Check Types:**

```typescript
type HealthCheck = 
  | { type: 'http'; url: string; expectedStatus?: number }
  | { type: 'grpc'; host: string; port: number }
  | { type: 'tcp'; host: string; port: number }
  | { type: 'composite'; checks: HealthCheck[] };
```

**Definition of Done:**
- HTTP health checks work for Splice validators
- gRPC health checks work for Canton participants
- Retries with backoff implemented
- Timeouts prevent hanging

#### 3.4 Dependency Ordering
**Priority:** P0  
**Effort:** 0.5 days

- [ ] Define container startup order based on dependencies
- [ ] Implement parallel startup for independent containers
- [ ] Wait for health before starting dependents
- [ ] Handle startup failures with clear error messages

**Dependency Chain:**
```
postgres → canton → splice → nginx + web UIs
                 ↘ keycloak (if OAuth2)
```

**Definition of Done:**
- Containers start in correct order
- Health checks gate dependent containers
- Startup failures are reported clearly

#### 3.5 Network Management
**Priority:** P0  
**Effort:** 0.5 days

- [ ] Create isolated Docker network for LocalNet
- [ ] Configure container hostnames/aliases
- [ ] Support custom network names (avoid conflicts)
- [ ] Clean up networks on destroy

**Definition of Done:**
- Containers can communicate via network aliases
- Network names are unique per LocalNet instance
- Networks are cleaned up properly

#### 3.6 Lifecycle Management
**Priority:** P0  
**Effort:** 1 day

- [ ] Implement `start()` - generate configs, create network, start containers
- [ ] Implement `stop()` - stop containers (preserve data)
- [ ] Implement `destroy()` - stop, remove containers, remove volumes
- [ ] Implement `restart()` - stop + start
- [ ] Add state tracking (starting, running, stopping, stopped)
- [ ] Handle partial failures gracefully

**Definition of Done:**
- Full lifecycle works end-to-end
- State transitions are tracked
- Partial failures don't leave orphaned resources

### Phase 3 Deliverables

- Docker API wrapper
- Container orchestration logic
- Health check system
- Lifecycle management

### Dependencies

- Phase 2 (configuration generation)

---

## 6. Phase 4: State Management & Discovery

### Objective

Provide APIs to query and manage runtime state: parties, users, packages, and connection information.

### Tasks

#### 4.1 Canton API Client
**Priority:** P0  
**Effort:** 1.5 days

- [ ] Create HTTP client for Canton JSON API v2
- [ ] Implement party operations:
  - `listParties()` - GET /v2/parties
  - `allocateParty(hint, displayName)` - POST /v2/parties
  - `getParticipantId()` - GET /v2/parties/participant-id
- [ ] Implement user operations:
  - `listUsers()` - GET /v2/users
  - `createUser(id, primaryParty, rights)` - POST /v2/users
  - `grantRights(userId, party, rights)` - POST /v2/users/{id}/rights
- [ ] Implement package operations:
  - `listPackages()` - GET /v2/packages
  - `uploadDar(darPath)` - POST /v2/dars

**Definition of Done:**
- All API operations implemented and tested
- Error handling for API failures
- Proper typing for all responses

#### 4.2 OAuth2 Token Management
**Priority:** P0  
**Effort:** 0.5 days

- [ ] Implement OAuth2 client credentials flow
- [ ] Add token caching with expiry tracking
- [ ] Support refresh before expiry (30s buffer)
- [ ] Support multiple realms (different clients)
- [ ] Add fallback to shared-secret JWT for testing

**Token Cache:**

```typescript
interface TokenCache {
  token: string;
  expiresAt: number;  // Unix timestamp
}

// Refresh 30s before expiry
const REFRESH_BUFFER_MS = 30_000;
```

**Definition of Done:**
- Tokens are cached and reused
- Automatic refresh before expiry
- Works with Keycloak realms

#### 4.3 State Manager
**Priority:** P0  
**Effort:** 1 day

- [ ] Create StateManager class to aggregate all state
- [ ] Implement party discovery (query all validators)
- [ ] Implement package tracking (track uploads)
- [ ] Implement user management (create/query users)
- [ ] Add caching layer with configurable TTL
- [ ] Support cache invalidation

**State Manager API:**

```typescript
interface StateManager {
  // Parties
  getParties(): Promise<PartyInfo[]>;
  getParty(hint: string): Promise<PartyInfo>;
  allocateParty(hint: string, validator: string): Promise<PartyInfo>;
  
  // Users
  getUsers(validator: string): Promise<UserInfo[]>;
  createUser(config: UserConfig, validator: string): Promise<UserInfo>;
  
  // Packages
  getPackages(): Promise<PackageInfo[]>;
  uploadDar(path: string, validators: string[]): Promise<PackageInfo>;
  
  // Cache
  invalidateCache(): void;
}
```

**Definition of Done:**
- State manager works with running LocalNet
- Caching reduces API calls
- Cache invalidation works correctly

#### 4.4 Discovery Server
**Priority:** P1  
**Effort:** 1 day

- [ ] Create Hono HTTP server for discovery API
- [ ] Implement endpoints:
  - `GET /discovery/status` - Health check all services
  - `GET /discovery/parties` - List all parties
  - `GET /discovery/parties/:validator` - Party for specific validator
  - `GET /discovery/packages` - List all packages
  - `GET /discovery/packages/:name` - Specific package
  - `GET /discovery/env/:validator` - Environment config
  - `POST /discovery/invalidate` - Clear cache
- [ ] Add JSON and dotenv output formats
- [ ] Add OpenAPI documentation

**Definition of Done:**
- All endpoints work correctly
- JSON and dotenv formats supported
- Server can be started independently

### Phase 4 Deliverables

- Canton API client
- OAuth2 token management
- State manager with caching
- Discovery HTTP server

### Dependencies

- Phase 3 (container orchestration - LocalNet must be running)

---

## 7. Phase 5: CLI Tool

### Objective

Provide a command-line interface for manual LocalNet operations.

### Tasks

#### 5.1 CLI Framework Setup
**Priority:** P0  
**Effort:** 0.5 days

- [ ] Set up Cliffy CLI framework
- [ ] Configure global options (--config, --verbose, --version)
- [ ] Implement help system
- [ ] Add command discovery/registration pattern
- [ ] Configure output formatting (text, JSON)

**Definition of Done:**
- `localnet --help` shows all commands
- Global options work with all commands
- Version command works

#### 5.2 Core Commands
**Priority:** P0  
**Effort:** 1.5 days

- [ ] `localnet start` - Generate configs and start LocalNet
  - Options: --no-generate, --wait, --timeout
- [ ] `localnet stop` - Stop LocalNet
  - Options: --clean (remove volumes)
- [ ] `localnet status` - Show health status
  - Options: --format (text/json), --watch
- [ ] `localnet destroy` - Stop and remove all resources

**Definition of Done:**
- All core commands work correctly
- Options function as documented
- Error messages are helpful

#### 5.3 Query Commands
**Priority:** P0  
**Effort:** 1 day

- [ ] `localnet parties` - List party IDs
  - Options: --format (text/json/env), --validator
- [ ] `localnet packages` - List package IDs
  - Options: --format (text/json/env), --name
- [ ] `localnet users` - List users
  - Options: --validator
- [ ] `localnet env` - Generate environment file
  - Options: --format (dotenv/json/ts), --output

**Definition of Done:**
- All query commands return correct data
- Multiple output formats work
- Commands handle errors gracefully

#### 5.4 Generation Commands
**Priority:** P1  
**Effort:** 0.5 days

- [ ] `localnet generate` - Generate all configs
  - Options: --hocon, --env, --keycloak, --compose, --all
  - Options: --output-dir, --dry-run
- [ ] `localnet validate` - Validate localnet.yaml

**Definition of Done:**
- Generation produces correct files
- Dry-run shows what would be generated
- Validation gives helpful error messages

#### 5.5 Server Command
**Priority:** P1  
**Effort:** 0.5 days

- [ ] `localnet serve` - Start discovery API server
  - Options: --port, --host, --background

**Definition of Done:**
- Server starts and handles requests
- Background mode works (daemonize)

### Phase 5 Deliverables

- Complete CLI tool with all commands
- Installation script (`deno install`)
- Shell completions (optional)

### Dependencies

- Phase 4 (state management - needed for query commands)

---

## 8. Phase 6: SDK & Testcontainers API

### Objective

Provide a Testcontainers-style TypeScript SDK for programmatic LocalNet control in tests.

### Tasks

#### 6.1 LocalNet Class
**Priority:** P0  
**Effort:** 1.5 days

- [ ] Create `LocalNet` class with fluent builder API
- [ ] Implement configuration methods:
  - `withValidators(count | configs)`
  - `withParties(configs)`
  - `withUsers(configs)`
  - `withPackages(paths)`
  - `withAuth(config)`
- [ ] Implement `start()` returning `StartedLocalNet`
- [ ] Support configuration from file or programmatic

**SDK API Design:**

```typescript
// Fluent builder pattern
const localnet = await new LocalNet()
  .withValidators(2)
  .withParties([
    { hint: 'alice', validator: 'validator-1' },
    { hint: 'bob', validator: 'validator-2' },
  ])
  .withPackages(['./my-app.dar'])
  .start();

// Or from config file
const localnet = await LocalNet.fromConfig('./localnet.yaml').start();
```

**Definition of Done:**
- Fluent builder API works correctly
- Configuration and file modes both work
- Start returns properly typed StartedLocalNet

#### 6.2 StartedLocalNet Class
**Priority:** P0  
**Effort:** 1.5 days

- [ ] Create `StartedLocalNet` class for runtime operations
- [ ] Implement query methods:
  - `getParties()` / `getParty(hint)`
  - `getPackages()` / `getPackage(name)`
  - `getUsers(validator)`
  - `getConnectionInfo()`
- [ ] Implement mutation methods:
  - `createParty(hint, validator)`
  - `createUser(config)`
  - `uploadDar(path, validators)`
- [ ] Implement lifecycle methods:
  - `stop()` - Stop containers
  - `destroy()` - Stop and remove
- [ ] Implement `Symbol.asyncDispose` for `await using`

**Runtime API:**

```typescript
interface StartedLocalNet {
  // Query
  getParties(): Promise<PartyInfo[]>;
  getParty(hint: string): Promise<PartyInfo>;
  getConnectionInfo(): ConnectionInfo;
  
  // Mutate
  createParty(hint: string, validator?: string): Promise<PartyInfo>;
  createUser(config: UserConfig): Promise<UserInfo>;
  uploadDar(path: string): Promise<PackageInfo>;
  
  // Lifecycle
  stop(): Promise<void>;
  destroy(): Promise<void>;
  
  // AsyncDisposable
  [Symbol.asyncDispose](): Promise<void>;
}
```

**Definition of Done:**
- All methods work correctly
- AsyncDisposable pattern works with `await using`
- Connection info provides all URLs and tokens

#### 6.3 Test Helpers
**Priority:** P1  
**Effort:** 1 day

- [ ] Create test setup helpers for common patterns
- [ ] Implement shared LocalNet singleton for test suites
- [ ] Add Deno test hooks (beforeAll, afterAll wrappers)
- [ ] Create assertion helpers for Canton state

**Test Helper Example:**

```typescript
import { withLocalNet } from '@mg-localnet/test-helpers';

Deno.test('my test', async () => {
  await using localnet = await LocalNet.minimal().start();
  
  const party = await localnet.createParty('test-party');
  assertEquals(party.hint, 'test-party');
});
```

**Definition of Done:**
- Test helpers simplify common patterns
- Shared LocalNet reduces test suite time
- Assertions work correctly

### Phase 6 Deliverables

- LocalNet SDK with fluent API
- StartedLocalNet runtime class
- Test helpers and utilities
- API documentation

### Dependencies

- Phase 5 (CLI - shares underlying implementation)

---

## 9. Phase 7: Integration & Testing

### Objective

Ensure all components work together, create comprehensive tests, and document the system.

### Tasks

#### 7.1 Unit Tests
**Priority:** P0  
**Effort:** 1 day

- [ ] Test configuration schema validation
- [ ] Test HOCON generation
- [ ] Test environment file generation
- [ ] Test Keycloak realm generation
- [ ] Test port allocation logic
- [ ] Test Canton API client (mocked)
- [ ] Test OAuth2 token management (mocked)

**Definition of Done:**
- >80% code coverage on core modules
- All edge cases tested
- Tests run in <30 seconds

#### 7.2 Integration Tests
**Priority:** P0  
**Effort:** 1.5 days

- [ ] Test full LocalNet lifecycle (start → query → stop)
- [ ] Test party creation and discovery
- [ ] Test user creation with rights
- [ ] Test DAR upload and package discovery
- [ ] Test multiple validator configuration
- [ ] Test OAuth2 authentication flow

**Definition of Done:**
- Integration tests pass against real Docker
- Tests clean up after themselves
- Tests can run in CI

#### 7.3 Example Projects
**Priority:** P1  
**Effort:** 0.5 days

- [ ] Create minimal example (1 validator, 1 party)
- [ ] Create two-validator example (transfer scenario)
- [ ] Create full-stack example (all features)
- [ ] Document each example

**Definition of Done:**
- Examples work out of the box
- README explains each example
- Examples demonstrate key features

#### 7.4 Documentation
**Priority:** P1  
**Effort:** 1 day

- [ ] Write README with quick start
- [ ] Document CLI commands
- [ ] Document SDK API
- [ ] Document configuration schema
- [ ] Add architecture diagrams
- [ ] Create troubleshooting guide

**Definition of Done:**
- README is complete and accurate
- API documentation is comprehensive
- Examples are documented

### Phase 7 Deliverables

- Comprehensive test suite
- Example projects
- Complete documentation

### Dependencies

- All previous phases

---

## 10. Risk Analysis

### High-Risk Items

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Docker API complexity** | Container management fails | Medium | Start with Docker Compose subprocess as fallback; add direct Docker API later |
| **Canton HOCON format changes** | Generated configs invalid | Low | Pin to specific Canton version; monitor upstream changes |
| **OAuth2 token issues** | Auth failures | Medium | Implement comprehensive token refresh; support shared-secret fallback |
| **Resource constraints** | OOM on developer machines | Medium | Provide memory limit options; document requirements |
| **Startup time** | Tests too slow | High | Implement shared LocalNet singleton; document minimum startup time |

### Medium-Risk Items

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Port conflicts** | Containers fail to start | Medium | Detect port conflicts before start; provide port override options |
| **Volume mount issues** | Configs not readable | Low | Validate mounts before start; provide clear error messages |
| **Network isolation** | Containers can't communicate | Low | Use explicit network creation; validate connectivity |
| **Keycloak import failures** | OAuth2 not available | Medium | Validate realm JSON before import; provide fallback |

### Orchestration Strategy: Docker API Direct

**Decision: Use Docker API directly (via Dockerode), NOT Docker Compose.**

Rationale:
- Full programmatic control over individual containers
- No YAML file generation/templating complexity
- Better error handling and logging per container
- Dynamic configuration at runtime
- Matches Testcontainers internal architecture
- Can export Compose files as a user-facing feature if needed later

This approach is slightly more complex upfront but provides better long-term flexibility and matches the Testcontainers pattern we're emulating.

**Kubernetes**: Deliberately not supported in v1.
- Adds 20-55 seconds startup overhead (vs 2-5s for Docker)
- Helm charts exist but are production-focused
- Can be added later if user demand materializes

---

## 11. Success Criteria

### Phase 1: Foundation
- [ ] Project structure complete
- [ ] Types compile without errors
- [ ] Configuration loading works with example file

### Phase 2: Configuration Generation
- [ ] Generate valid Canton HOCON for 1-5 validators
- [ ] Generate valid Splice HOCON
- [ ] Generate valid Keycloak realm JSON
- [ ] Generated configs work with existing Docker images

### Phase 3: Container Orchestration
- [ ] Start LocalNet with single command
- [ ] All containers healthy within 5 minutes
- [ ] Stop/destroy cleans up all resources

### Phase 4: State Management
- [ ] Query parties from running LocalNet
- [ ] Query packages from running LocalNet
- [ ] Create new parties via API
- [ ] Create new users via API

### Phase 5: CLI Tool
- [ ] `localnet start` works end-to-end
- [ ] `localnet parties` shows discovered parties
- [ ] `localnet env` generates valid environment files

### Phase 6: SDK
- [ ] Testcontainers-style API works
- [ ] `await using` cleanup pattern works
- [ ] Integration with Deno test framework

### Phase 7: Integration
- [ ] All tests pass
- [ ] Examples work out of the box
- [ ] Documentation is complete

### Overall Success Metrics
- [ ] LocalNet starts in <5 minutes (same as current)
- [ ] Configuration reduced from 100+ files to 1 file
- [ ] API provides all runtime state (parties, packages, users)
- [ ] Works as test fixture in automated tests

---

## 12. Appendix: Technical Reference

### A. Port Allocation Scheme

| Suffix | API Type | Description |
|--------|----------|-------------|
| 901 | Ledger API (gRPC) | Application interface |
| 902 | Admin API (gRPC) | Node management |
| 903 | Validator Admin API | Splice validator HTTP |
| 975 | JSON API (HTTP) | REST interface |
| 900 | HTTP Health | HTTP health endpoint |
| 961 | gRPC Health | gRPC health endpoint |

**Prefix by Role:**
- `2xxx` - Validator 1 (App User equivalent)
- `3xxx` - Validator 2 (App Provider equivalent)
- `4xxx` - Super Validator
- `5xxx` - SV internal services (sequencer, mediator, scan)

### B. Database Names

| Component | Database Name |
|-----------|---------------|
| Participant (Validator N) | `participant_validator_N` |
| Sequencer | `sequencer` |
| Mediator | `mediator` |
| Validator App | `validator_validator_N` |
| Scan | `scan` |
| SV App | `sv` |
| PQS | `pqs_validator_N` |

### C. Canton JSON API v2 Endpoints

```
# Party Management
POST /v2/parties                    # Allocate party
GET  /v2/parties                    # List parties
GET  /v2/parties/participant-id     # Get participant namespace

# User Management
POST /v2/users                      # Create user
GET  /v2/users/{id}                 # Get user
POST /v2/users/{id}/rights          # Grant rights

# Package Management
POST /v2/dars?vetAllPackages=true   # Upload DAR
GET  /v2/packages                   # List packages

# Health
GET  /v2/version                    # Version/health check
```

### D. OAuth2 Token Request

```bash
curl -X POST "http://keycloak:8082/realms/{realm}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id={client_id}" \
  -d "client_secret={client_secret}" \
  -d "scope=openid"
```

Response:
```json
{
  "access_token": "eyJ...",
  "expires_in": 300,
  "token_type": "Bearer"
}
```

### E. Example localnet.yaml

```yaml
version: "1.0"

# Number of regular Validators to create.
# Super Validator (SV) is ALWAYS created automatically - you don't configure it.
# The SV runs the Global Synchronizer that all Validators connect to.
validators: 2  # Creates validator-1 and validator-2

# Or use detailed configuration:
# validators:
#   - name: validator-1
#     parties:
#       - hint: alice
#     users:
#       - id: alice-user
#         primaryParty: alice
#         rights: [CanActAs, CanReadAs]
#   - name: validator-2
#     parties:
#       - hint: bob
#     users:
#       - id: bob-user
#         primaryParty: bob
#         rights: [CanActAs, CanReadAs]

# Authentication (OAuth2 via Keycloak)
auth:
  mode: oauth2
  keycloak:
    url: http://localhost:8082
    admin: admin
    password: admin
    audience: https://canton.network.global

# Packages to upload (optional)
packages:
  - name: my-app
    dar: ./my-app.dar
    uploadTo: [validator-1, validator-2]

# Discovery server (optional)
discovery:
  port: 3100
  host: 127.0.0.1
```

### F. Minimal Configuration

```yaml
# Absolute minimal config - just specify validator count
validators: 2

# Everything else uses defaults:
# - OAuth2 with Keycloak on port 8082
# - No pre-configured parties (create at runtime)
# - No packages (upload at runtime)
```

### G. SDK Usage Examples

```typescript
// Minimal - just start with defaults (SV + 2 Validators)
const localnet = await new LocalNet().start();

// Specify validator count
const localnet = await new LocalNet()
  .withValidators(3)  // Creates 3 regular Validators + 1 SV (implicit)
  .start();

// Full configuration
const localnet = await new LocalNet()
  .withValidators([
    { name: 'alice-validator', parties: [{ hint: 'alice' }] },
    { name: 'bob-validator', parties: [{ hint: 'bob' }] },
  ])
  .withPackages(['./my-app.dar'])
  .start();

// Use with automatic cleanup
await using localnet = await new LocalNet().withValidators(2).start();
// ... use localnet
// Automatically destroyed when scope exits
```

---

*Plan created: January 2026*  
*Status: Ready for Implementation Review*
