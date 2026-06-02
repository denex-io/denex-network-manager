# Canton LocalNet Deep Analysis

> [!WARNING]
> Historical research. Canton/Splice concepts here may still be useful, but implementation details
> should be verified against current source files and `agents/` guidance.

> Comprehensive research document analyzing how Canton LocalNet works in both Splice and CN-Quickstart, with the goal of informing the design of simplified, programmable LocalNet tooling.

**Date:** January 2026  
**Project:** mg-localnet (Better Canton LocalNet Tools)  
**Status:** Research Complete

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Canton Network Architecture Fundamentals](#canton-network-architecture-fundamentals)
3. [Splice LocalNet Architecture](#splice-localnet-architecture)
4. [CN-Quickstart Architecture](#cn-quickstart-architecture)
5. [Configuration Deep Dive](#configuration-deep-dive)
6. [Component Relationships & Data Flows](#component-relationships--data-flows)
7. [APIs & Interfaces](#apis--interfaces)
8. [Party, User & Permission Model](#party-user--permission-model)
9. [Pain Points & Complexity Analysis](#pain-points--complexity-analysis)
10. [Building Blocks for Simplification](#building-blocks-for-simplification)
11. [Appendix: Key Files Reference](#appendix-key-files-reference)

---

## Executive Summary

### What is a Canton LocalNet?

A Canton LocalNet is a self-contained instance of all necessary Canton Network components running on a single machine for development, testing, and demo purposes. It includes:

- **Super Validator (SV)**: Operates the Global Synchronizer (sequencer + mediator)
- **Validators**: Host participants for users and applications
- **Participants**: Canton nodes that host parties and execute smart contracts
- **PostgreSQL**: Persistent storage for all components
- **Auth Backend**: Either OAuth2 (Keycloak) or shared-secret JWT
- **Web UIs**: Wallet, ANS, Scan, SV governance interfaces

### Current State of Tooling

| Aspect | Splice LocalNet | CN-Quickstart |
|--------|-----------------|---------------|
| **Purpose** | Infrastructure testing | App development |
| **Complexity** | High (60+ config files) | Higher (adds modules) |
| **Memory** | ~8GB minimum | ~8-10GB |
| **Startup** | 2-5 minutes | 2-5 minutes |
| **Topology** | Fixed 3 validators | Fixed 3 validators |
| **Auth** | Shared-secret only | OAuth2 + shared-secret |
| **Programmatic Control** | Shell scripts | Make + shell scripts |
| **State Querying** | Manual API calls | Manual API calls |
| **Configuration** | HOCON + env files | HOCON + env + YAML |

### Key Insight

Both systems achieve the same goal (running a LocalNet) but through **configuration sprawl** rather than **programmatic control**. The 60+ configuration files in Splice LocalNet and the additional modules in Quickstart make it extremely difficult to:

1. Understand what's running and how components connect
2. Customize the topology (add/remove validators)
3. Query the state of the network programmatically
4. Integrate with test frameworks (Testcontainers-style)
5. Manage parties, users, and permissions dynamically

---

## Canton Network Architecture Fundamentals

### Core Concepts

#### Parties
- **Definition**: Unique identifiers across the entire Canton network
- **Format**: `<hint>::<namespace-fingerprint>` (e.g., `alice::1220f2fe29866fd6...`)
- **Hosting**: Parties are hosted on Participants
- **Usage**: Used in Daml contracts as signatories, observers, controllers

#### Users
- **Definition**: Local identities on each Participant for API access
- **Distinction**: Users are NOT parties - they have rights to ACT AS parties
- **Rights**: 
  - `CanActAs(party)` - Submit commands as a party
  - `CanReadAs(party)` - Read contracts visible to a party
  - `ParticipantAdmin` - Administrative privileges
- **Auth**: Authenticated via JWT tokens (OAuth2 or shared-secret)

#### Contracts
- **Definition**: Instances of Daml templates stored on the ledger
- **Lifecycle**: Created → Active → Archived (immutable once created)
- **ACS**: Active Contract Set - the current state of all active contracts
- **Privacy**: Each participant only sees contracts involving their hosted parties

### Node Types

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Canton Network Node Hierarchy                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SUPER VALIDATOR (SV)                                                        │
│  ├── SV App (governance, rewards)                                            │
│  ├── Scan App (blockchain explorer)                                          │
│  ├── Participant (hosts SV party)                                            │
│  ├── Sequencer (orders transactions)                                         │
│  ├── Mediator (validates transactions)                                       │
│  └── CometBFT Node (BFT consensus, production only)                          │
│                                                                              │
│  VALIDATOR                                                                   │
│  ├── Validator App (user/party management)                                   │
│  ├── Participant (hosts user parties)                                        │
│  └── Wallet (token management)                                               │
│                                                                              │
│  PARTICIPANT (standalone)                                                    │
│  ├── Ledger API (gRPC - application interface)                               │
│  ├── Admin API (gRPC - node management)                                      │
│  ├── JSON API (HTTP - REST interface)                                        │
│  └── Storage (PostgreSQL)                                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Transaction Flow

```
1. User submits command via Ledger API
           │
           ▼
2. Participant validates locally
           │
           ▼
3. Participant sends to Sequencer (Global Synchronizer)
           │
           ▼
4. Sequencer orders transaction, broadcasts to stakeholders
           │
           ▼
5. Mediator collects validation confirmations
           │
           ▼
6. Mediator commits or rejects transaction
           │
           ▼
7. Participants update their ACS (Active Contract Set)
           │
           ▼
8. Scan indexes the transaction for explorer
```

---

## Splice LocalNet Architecture

### Overview

Splice LocalNet is the **reference implementation** for running a Canton Network locally. It's designed primarily for **infrastructure testing** rather than application development.

### Directory Structure

```
splice/cluster/compose/localnet/
├── compose.yaml                    # Main Docker Compose (279 lines)
├── compose.env                     # Compose environment variables
├── resource-constraints.yaml       # Memory limits
├── env/
│   ├── common.env                  # Shared settings (ports, DB, UI)
│   ├── postgres.env                # Database names to create
│   ├── splice.env                  # Splice-specific settings
│   ├── sv-auth-on.env              # SV auth configuration
│   ├── app-provider-auth-on.env    # App Provider auth config
│   └── app-user-auth-on.env        # App User auth config
├── conf/
│   ├── canton/
│   │   ├── app.conf                # Base participant config (129 lines)
│   │   ├── sv/app.conf             # SV participant + sequencer + mediator
│   │   ├── app-provider/app.conf   # App Provider participant
│   │   └── app-user/app.conf       # App User participant
│   ├── splice/
│   │   ├── app.conf                # Base validator config (62 lines)
│   │   ├── sv/app.conf             # SV app + scan + validator
│   │   ├── app-provider/app.conf   # App Provider validator
│   │   └── app-user/app.conf       # App User validator
│   ├── console/                    # Canton console configs
│   └── nginx/                      # Reverse proxy configs
└── docker/
    ├── postgres/postgres-entrypoint.sh  # Creates 14 databases
    ├── canton/health-check.sh           # gRPC health checks
    ├── splice/health-check.sh           # HTTP readyz checks
    └── console/                         # Console container
```

### Docker Services

| Service | Image | Memory | What It Runs |
|---------|-------|--------|--------------|
| `postgres` | `postgres:14` | 2GB | 14 separate databases |
| `canton` | `canton:${TAG}` | 4GB | 3 participants + sequencer + mediator |
| `splice` | `splice-app:${TAG}` | 3GB | 3 validators + scan + sv app |
| `nginx` | `nginx:1.27` | 32MB | Reverse proxy for UIs |
| `wallet-web-ui-*` | `wallet-web-ui:${TAG}` | 256MB each | Wallet interfaces (x3) |
| `ans-web-ui-*` | `ans-web-ui:${TAG}` | 256MB each | Name service UIs (x2) |
| `sv-web-ui` | `sv-web-ui:${TAG}` | 512MB | SV governance UI |
| `scan-web-ui` | `scan-web-ui:${TAG}` | 256MB | Transaction explorer |

### Profile System

Splice uses Docker Compose profiles to enable/disable validator stacks:

```yaml
# Enable via command line or environment
docker compose --profile sv --profile app-provider --profile app-user up

# Or disable specific profiles
SV_PROFILE=off APP_USER_PROFILE=off docker compose up
```

**Available Profiles:**
- `sv` - Super Validator services
- `app-provider` - App Provider services
- `app-user` - App User services
- `console` - Canton interactive console
- `swagger-ui` - API documentation

### Port Allocation Scheme

**Pattern:** `<prefix><suffix>` where:
- **Prefix**: `4` (SV), `3` (App Provider), `2` (App User)
- **Suffix**: Identifies the API type

| Suffix | API Type | SV Port | App Provider | App User |
|--------|----------|---------|--------------|----------|
| `901` | Ledger API (gRPC) | 4901 | 3901 | 2901 |
| `902` | Admin API (gRPC) | 4902 | 3902 | 2902 |
| `903` | Validator Admin API | 4903 | 3903 | 2903 |
| `975` | JSON API (HTTP) | 4975 | 3975 | 2975 |
| `961` | gRPC Health Check | 4961 | 3961 | 2961 |
| `900` | HTTP Health Check | 4900 | 3900 | 2900 |

**UI Ports:** 4000 (SV), 3000 (App Provider), 2000 (App User)

### Configuration Format: HOCON

Canton uses HOCON (Human-Optimized Config Object Notation) for configuration:

```hocon
# Template definition with variable substitution
_storage {
  type = postgres
  config {
    properties {
      serverName = ${?DB_SERVER}      # Environment variable
      databaseName = participant
      user = ${?DB_USER}
      password = ${?DB_PASSWORD}
    }
  }
}

# Template usage with override
canton {
  participants {
    sv1Participant = ${_participant} {
      storage.config.properties.databaseName = "participant_sv"
    }
  }
}

# Include directives for modularity
include file("/app/sv/on/app.conf")
include file("/app/sv/on/app-auth.conf")
```

### Key Design Patterns

1. **Container Multiplexing**: Single `canton` container runs 5 processes (3 participants + sequencer + mediator)
2. **Profile-Based Composition**: Profiles enable/disable entire validator stacks
3. **Shared Infrastructure**: Single PostgreSQL with multiple databases
4. **Configuration Layering**: Base configs + profile-specific overrides + auth configs
5. **Environment Variable Substitution**: HOCON `${?VAR}` pattern throughout

---

## CN-Quickstart Architecture

### Overview

CN-Quickstart builds on Splice LocalNet to provide a **developer-focused scaffolding** with additional features for application development.

### What Quickstart Adds

| Feature | Splice LocalNet | CN-Quickstart |
|---------|-----------------|---------------|
| OAuth2 Auth | No | Keycloak integration |
| Query Store | No | PQS for each participant |
| Observability | No | Grafana/Prometheus/Loki/Tempo |
| Onboarding Automation | No | splice-onboarding module |
| Reference App | No | Licensing workflow demo |
| Backend Service | No | Spring Boot reference impl |
| Frontend | Wallet/ANS only | Custom React app |
| Daml Shell | No | Interactive Daml REPL |

### Modular Architecture

```
quickstart/
├── compose.yaml                    # Main compose (extends modules)
├── .env                            # Core configuration
├── Makefile                        # 40+ orchestration targets
├── docker/
│   ├── modules/
│   │   ├── localnet/               # Splice LocalNet (symlinked or copied)
│   │   ├── splice-onboarding/      # Initialization automation
│   │   ├── pqs/                    # Participant Query Store
│   │   ├── keycloak/               # OAuth2 provider
│   │   ├── observability/          # Grafana stack
│   │   └── daml-shell/             # Interactive Daml REPL
│   ├── backend-service/            # Spring Boot backend
│   └── register-app-user-tenant/   # Tenant registration
├── backend/                        # Java/Spring Boot backend
├── frontend/                       # React/TypeScript frontend
└── daml/
    └── licensing/                  # Reference Daml contracts
```

### Module System

Quickstart's key innovation is its **modular Docker Compose system** where modules can be toggled on/off:

```makefile
# From Makefile - compose file assembly
COMPOSE_FILES := \
    -f compose.yaml \
    -f docker/modules/localnet/compose.yaml \
    -f docker/modules/splice-onboarding/compose.yaml \
    -f docker/modules/pqs/compose.yaml \
    $(if $(OAUTH2_ENABLED),-f docker/modules/keycloak/compose.yaml) \
    $(if $(OBSERVABILITY_ENABLED),-f docker/modules/observability/compose.yaml)
```

### Splice-Onboarding Module (Critical Component)

The `splice-onboarding` module is the **automation engine** that handles initialization:

**Mode 1: One-Time Setup (`--init`)**
- Creates ledger users with permissions
- Uploads DAR files to participants
- Executes custom scripts from `/app/scripts/on/`

**Mode 2: Workflow Execution (`--exit-on-finish`)**
- Used by dependent services (e.g., `register-app-user-tenant`)
- Executes specific automation after dependencies are ready

**Key Utility Functions** (`utils.sh`):

```bash
# JWT token generation
generate_jwt(sub, aud)              # Create unsafe JWT

# User management
create_user(token, userId, userName, party, participant)
grant_rights(token, userId, partyId, rights, participant)
get_user_party(token, user, participant)

# Party management
allocate_party(token, partyIdHint, participant)
get_participant_namespace(token, participant)
onboard_wallet_user(token, user, party, validator)

# Package management
upload_dars(token, participant)     # Upload all .dar files

# Configuration sharing
share_file(relative_path)           # Write to /onboarding volume
```

**Dynamic Configuration Pattern:**

```bash
# In onboarding script
APP_PROVIDER_PARTY=$(get_user_party "$TOKEN" "app-provider" "$PARTICIPANT")

# Share with other containers via volume
share_file "backend-service/on/backend-service.sh" <<EOF
export APP_PROVIDER_PARTY=${APP_PROVIDER_PARTY}
EOF

# Backend container sources this file on startup
source /onboarding/backend-service/on/backend-service.sh
```

### PQS (Participant Query Store)

PQS provides **SQL-based access** to ledger data:

```yaml
# docker/modules/pqs/compose.yaml
services:
  pqs-app-provider:
    image: digitalasset/pqs:${PQS_VERSION}
    environment:
      - LEDGER_HOST=canton
      - LEDGER_PORT=3901
      - POSTGRES_HOST=postgres
      - POSTGRES_DATABASE=pqs-app-provider
```

**Benefits:**
- SQL queries instead of streaming Ledger API
- Faster complex queries
- Used by backend services and Daml Shell

### Keycloak OAuth2 Module

**Pre-configured Realms:**
- `AppProvider` - For application provider services
- `AppUser` - For end-user services

**Pre-configured Clients:**

| Realm | Client ID | Purpose |
|-------|-----------|---------|
| AppProvider | `app-provider-validator` | Validator service |
| AppProvider | `app-provider-backend` | Backend service |
| AppProvider | `app-provider-wallet` | Wallet UI |
| AppUser | `app-user-validator` | Validator service |
| AppUser | `app-user-wallet` | Wallet UI |

**Token Flow:**
1. Client requests token from Keycloak
2. Token includes user/client identity
3. Canton validates JWT signature and claims
4. User rights determine allowed operations

### Observability Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    Observability Stack                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐    ┌─────────────┐    ┌─────────┐              │
│  │ Grafana │◄───│ Prometheus  │◄───│ Canton  │              │
│  │ :3030   │    │  (metrics)  │    │ metrics │              │
│  └─────────┘    └─────────────┘    └─────────┘              │
│       │                                                      │
│       │         ┌─────────────┐    ┌─────────┐              │
│       └────────►│    Loki     │◄───│ Fluentd │              │
│       │         │   (logs)    │    │  logs   │              │
│       │         └─────────────┘    └─────────┘              │
│       │                                                      │
│       │         ┌─────────────┐    ┌─────────┐              │
│       └────────►│   Tempo     │◄───│  OTEL   │              │
│                 │  (traces)   │    │ Collect │              │
│                 └─────────────┘    └─────────┘              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuration Deep Dive

### Environment Variable Hierarchy

```
Priority (lowest to highest):
1. Module compose.env files (defaults)
2. common.env (shared settings)
3. Module-specific env files
4. .env (project root)
5. .env.local (local overrides, gitignored)
6. Runtime exports in shell
```

### Key Configuration Categories

#### 1. Profile Control
```bash
SV_PROFILE=on                       # Enable Super Validator
APP_PROVIDER_PROFILE=on             # Enable App Provider
APP_USER_PROFILE=on                 # Enable App User
AUTH_MODE=oauth2                    # oauth2 or shared-secret
```

#### 2. Port Configuration
```bash
# Suffixes (combined with prefix 2/3/4)
PARTICIPANT_LEDGER_API_PORT_SUFFIX=901
PARTICIPANT_ADMIN_API_PORT_SUFFIX=902
PARTICIPANT_JSON_API_PORT_SUFFIX=975
VALIDATOR_ADMIN_API_PORT_SUFFIX=903

# UI Ports
APP_USER_UI_PORT=2000
APP_PROVIDER_UI_PORT=3000
SV_UI_PORT=4000
```

#### 3. Database Configuration
```bash
DB_USER=cnadmin
DB_PASSWORD=supersafe
DB_SERVER=postgres
DB_PORT=5432
```

#### 4. Auth Configuration (Shared-Secret Mode)
```bash
SPLICE_APP_UI_UNSAFE=true
SPLICE_APP_UI_UNSAFE_SECRET=unsafe
SPLICE_APP_VALIDATOR_AUTH_AUDIENCE=https://sv.example.com
```

### HOCON Configuration Patterns

#### Base Template Pattern
```hocon
# Define reusable template
_participant {
  init.identity.type = manual
  storage = ${_storage}
  ledger-api {
    address = "0.0.0.0"
    port = 5001
  }
}

# Use template with overrides
canton.participants {
  appProvider = ${_participant} {
    storage.config.properties.databaseName = "participant-app-provider"
    ledger-api.port = 3901
  }
}
```

#### Include Directive Pattern
```hocon
# Base config
include file("/app/app-provider/on/app.conf")
include file("/app/app-provider/on/app-auth.conf")

# Profile-based includes (on vs off directory)
# When APP_PROVIDER_PROFILE=on, mounts to /app/app-provider/on/
# When APP_PROVIDER_PROFILE=off, mounts to /app/app-provider/off/
```

#### Environment Variable Substitution
```hocon
properties {
  serverName = "localhost"              # Default value
  serverName = ${?POSTGRES_HOST}        # Override if env var set
}
```

---

## Component Relationships & Data Flows

### Container Dependency Chain

```
postgres (healthy)
    │
    ▼
canton (healthy)
    │ (waits for participants to be ready)
    ▼
splice (healthy)
    │ (waits for validators to be ready)
    ├──► splice-onboarding (runs once, uploads DARs, creates users)
    │
    ▼
nginx + web UIs
    │
    ▼
pqs (indexes ledger data)
    │
    ▼
backend-service (application logic)
```

### Network Communication

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Docker Network (quickstart)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐                         │
│  │ postgres │◄────│  canton  │◄────│  splice  │                         │
│  │   :5432  │     │ :Xxxx    │     │ :Xxxx    │                         │
│  └──────────┘     └────┬─────┘     └────┬─────┘                         │
│                        │                │                                │
│                        │  gRPC          │  HTTP                          │
│                        ▼                ▼                                │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐                         │
│  │   pqs    │────►│ backend  │────►│  nginx   │◄──── Host:2000/3000/4000│
│  │   :*     │     │  :8080   │     │  :*      │                         │
│  └──────────┘     └──────────┘     └──────────┘                         │
│                                         │                                │
│                                         ▼                                │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │                        Web UIs                                │       │
│  │  wallet-web-ui  │  ans-web-ui  │  sv-web-ui  │  scan-web-ui  │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Internal Port Mapping

| Container | Internal Port | External Port | Service |
|-----------|---------------|---------------|---------|
| canton | 4901 | 4901 | SV Ledger API |
| canton | 3901 | 3901 | App Provider Ledger API |
| canton | 2901 | 2901 | App User Ledger API |
| canton | 4902 | 4902 | SV Admin API |
| canton | 3902 | 3902 | App Provider Admin API |
| canton | 2902 | 2902 | App User Admin API |
| canton | 4975 | 4975 | SV JSON API |
| canton | 3975 | 3975 | App Provider JSON API |
| canton | 2975 | 2975 | App User JSON API |
| splice | 4903 | 4903 | SV Validator Admin |
| splice | 3903 | 3903 | App Provider Validator Admin |
| splice | 2903 | 2903 | App User Validator Admin |
| postgres | 5432 | 5432 | PostgreSQL |
| nginx | 4000 | 4000 | SV UIs |
| nginx | 3000 | 3000 | App Provider UIs |
| nginx | 2000 | 2000 | App User UIs |
| keycloak | 8082 | 8082 | OAuth2 |
| grafana | 3030 | 3030 | Observability |

---

## APIs & Interfaces

### 1. Ledger API (gRPC)

**Purpose:** Primary application interface to Canton
**Protocol:** gRPC with Protocol Buffers
**Ports:** 2901, 3901, 4901

**Key Services:**
- `CommandService` - Submit transactions
- `TransactionService` - Read transaction history
- `ActiveContractsService` - Query current contract state
- `PartyManagementService` - Allocate and query parties
- `UserManagementService` - Create and manage users
- `PackageService` - Upload and query Daml packages

### 2. JSON API (HTTP)

**Purpose:** REST interface for web applications
**Protocol:** HTTP/JSON
**Ports:** 2975, 3975, 4975

**Key Endpoints:**
```
POST /v2/commands                    # Submit command
GET  /v2/commands/{id}               # Get command status
GET  /v2/transactions                # Stream transactions
GET  /v2/active-contracts            # Query ACS
POST /v2/parties                     # Allocate party
GET  /v2/parties                     # List parties
POST /v2/users                       # Create user
GET  /v2/users/{id}                  # Get user
POST /v2/users/{id}/rights           # Grant rights
POST /v2/packages                    # Upload DAR
```

### 3. Admin API (gRPC)

**Purpose:** Node administration
**Protocol:** gRPC
**Ports:** 2902, 3902, 4902

**Capabilities:**
- Domain connection management
- Topology management
- Key management
- Health and status

### 4. Validator Admin API (HTTP)

**Purpose:** Splice validator management
**Protocol:** HTTP/JSON
**Ports:** 2903, 3903, 4903

**Key Endpoints:**
```
GET  /api/validator/readyz           # Health check
POST /api/validator/v0/admin/users   # Onboard wallet user
GET  /api/validator/v0/scan-proxy/*  # Proxy to scan
```

### 5. Scan API (HTTP)

**Purpose:** Blockchain explorer
**Protocol:** HTTP/JSON
**Port:** 5012 (internal), proxied via nginx

**Key Endpoints:**
```
GET  /api/scan/v0/dso-party-id       # Get DSO party ID
GET  /api/scan/v0/splice-instance-names  # Network metadata
GET  /api/scan/v0/rounds             # Mining rounds
```

### Authentication

**Shared-Secret Mode:**
```bash
# Generate JWT with jwt-cli
TOKEN=$(jwt-cli encode hs256 --s unsafe --p '{"sub": "admin", "aud": "https://sv.example.com"}')

# Use in requests
curl -H "Authorization: Bearer $TOKEN" http://localhost:3975/v2/users
```

**OAuth2 Mode:**
```bash
# Get token from Keycloak
TOKEN=$(curl -s http://keycloak.localhost:8082/realms/AppProvider/protocol/openid-connect/token \
  -d 'client_id=app-provider-validator' \
  -d 'client_secret=AL8648b9SfdTFImq7FV56Vd0KHifHBuC' \
  -d 'grant_type=client_credentials' | jq -r .access_token)
```

---

## Party, User & Permission Model

### Allocation Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Party & User Creation Flow                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. PARTICIPANT STARTUP                                                  │
│     Canton creates namespace                                             │
│     Namespace ID: 1220abc123...                                          │
│                          │                                               │
│                          ▼                                               │
│  2. SPLICE-ONBOARDING RUNS                                               │
│     Waits for Canton healthy                                             │
│                          │                                               │
│                          ▼                                               │
│  3. ALLOCATE PARTY                                                       │
│     POST /v2/parties { partyIdHint: "app-provider" }                     │
│     Response: app-provider::1220abc123...                                │
│                          │                                               │
│                          ▼                                               │
│  4. CREATE USER                                                          │
│     POST /v2/users { id: "admin", primaryParty: "app-provider::..." }    │
│                          │                                               │
│                          ▼                                               │
│  5. GRANT RIGHTS                                                         │
│     POST /v2/users/admin/rights                                          │
│     { ParticipantAdmin, CanActAs, CanReadAs }                            │
│                          │                                               │
│                          ▼                                               │
│  6. VALIDATOR ONBOARDING (for Splice integration)                        │
│     POST /api/validator/v0/admin/users                                   │
│     { party_id: "...", name: "admin" }                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Party ID Structure

```
<hint>::<namespace>
   │        │
   │        └── Fingerprint of participant's public key
   │            (identifies which participant hosts the party)
   │
   └── Human-readable identifier (provided at allocation)

Example: app-provider::1220f2fe29866fd6a0009ecc8a64ccdc09f1958bd0f801166baaee469d1251b2eb72
```

### User Rights

| Right | Description | Use Case |
|-------|-------------|----------|
| `ParticipantAdmin` | Full administrative access | Node operators |
| `CanActAs(party)` | Submit commands as party | Application users |
| `CanReadAs(party)` | Read contracts visible to party | Auditors, reporters |

### Multi-Party Patterns

**Single Party, Multiple Users:**
```
Party: treasury::1220...
├── User: admin       (ParticipantAdmin, CanActAs, CanReadAs)
├── User: operator    (CanActAs, CanReadAs)
└── User: viewer      (CanReadAs only)
```

**Multiple Parties, Single User:**
```
User: super-admin
├── CanActAs: treasury::1220...
├── CanActAs: operations::1220...
└── CanReadAs: audit::1220...
```

---

## Pain Points & Complexity Analysis

### 1. Configuration Sprawl

| Metric | Splice LocalNet | CN-Quickstart |
|--------|-----------------|---------------|
| Config files | 60+ | 100+ |
| Directories | 22 | 35+ |
| Lines of config | 570+ HOCON | 800+ HOCON + 500+ YAML |
| Environment files | 8 | 20+ |

**Impact:**
- Difficult to understand what's configured
- Hard to find the right file to modify
- Easy to miss configuration dependencies
- Debugging requires understanding multiple layers

### 2. Fixed Topology

**Current State:**
- 3 validators hardcoded (SV, App Provider, App User)
- Cannot add/remove validators dynamically
- Cannot change number of participants
- Profile system only enables/disables, doesn't modify

**Desired State:**
- Configurable number of validators (1-N)
- Dynamic party allocation
- On-demand participant addition
- Custom topology definition

### 3. No Programmatic Control

**Current State:**
- Shell scripts for orchestration
- Make targets for common operations
- Manual API calls for state queries
- No SDK/library for integration

**Desired State:**
- TypeScript/Python SDK
- Testcontainers-style API
- Programmatic state management
- Test framework integration

### 4. Opaque State

**Current State:**
- Party IDs only known after startup
- Package IDs not persisted
- No state export mechanism
- Manual discovery required

**Desired State:**
- Query API for all state
- State export/import
- Deterministic identifiers where possible
- Clear visibility into running components

### 5. Slow Development Cycle

| Operation | Current Time |
|-----------|--------------|
| Cold start | 2-5 minutes |
| Hot restart | 30-60 seconds |
| Full rebuild | 5-10 minutes |
| DAR upload | 10-30 seconds |

**Impact:**
- Long feedback loops
- Discourages iteration
- Testing becomes tedious

---

## Building Blocks for Simplification

### What to Preserve

1. **Docker Images**: Canton, Splice, and supporting images work well
2. **Port Allocation Scheme**: Prefix-based ports are intuitive once understood
3. **HOCON Format**: Powerful for Canton configuration (don't reinvent)
4. **splice-onboarding Utilities**: Shell functions for API calls are reusable
5. **Profile Concept**: Enable/disable components is useful
6. **Health Check Patterns**: gRPC and HTTP health checks work well

### What to Replace

1. **Configuration Management**: 
   - Replace 60+ files with single declarative config
   - Generate HOCON from high-level specification

2. **Orchestration**:
   - Replace Make/shell with programmatic API
   - Enable Testcontainers-style lifecycle management

3. **State Management**:
   - Build query API over existing endpoints
   - Persist and export network state

4. **Topology Definition**:
   - Allow flexible validator count
   - Support custom party/user configurations

### Proposed Abstraction Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        User-Facing API Layer                             │
│  LocalNet.start({ validators: 2, parties: ["alice", "bob"] })           │
├─────────────────────────────────────────────────────────────────────────┤
│                        Configuration Generator                           │
│  YAML/JSON spec → HOCON configs → Environment files                     │
├─────────────────────────────────────────────────────────────────────────┤
│                        Container Orchestration                           │
│  Docker Compose / Testcontainers / direct Docker API                    │
├─────────────────────────────────────────────────────────────────────────┤
│                        State Management API                              │
│  Query parties, users, contracts, packages                              │
├─────────────────────────────────────────────────────────────────────────┤
│                        Existing Infrastructure                           │
│  Canton images, Splice images, PostgreSQL                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions Needed

1. **Language/Runtime**: TypeScript (Deno), Python, Go, or multiple?
2. **Configuration Format**: YAML, JSON, or TypeScript DSL?
3. **Orchestration Method**: Docker Compose, Testcontainers, or custom?
4. **State Persistence**: In-memory, SQLite, or leverage PostgreSQL?
5. **Auth Default**: Shared-secret (simpler) or OAuth2 (realistic)?
6. **Splice Integration**: Required or optional module?

---

## Appendix: Key Files Reference

### Splice LocalNet

| Path | Purpose | Lines |
|------|---------|-------|
| `splice/cluster/compose/localnet/compose.yaml` | Main Docker Compose | 279 |
| `splice/cluster/compose/localnet/conf/canton/app.conf` | Canton base config | 129 |
| `splice/cluster/compose/localnet/conf/splice/app.conf` | Splice base config | 62 |
| `splice/cluster/compose/localnet/env/common.env` | Shared environment | 51 |
| `splice/build-tools/splice-localnet-compose.sh` | Start/stop script | 93 |

### CN-Quickstart

| Path | Purpose | Lines |
|------|---------|-------|
| `quickstart/compose.yaml` | Main compose (extends modules) | 64 |
| `quickstart/.env` | Core environment | 25 |
| `quickstart/Makefile` | Orchestration targets | 500+ |
| `docker/modules/splice-onboarding/docker/utils.sh` | API utilities | 297 |

### Configuration Templates

| Path | Purpose |
|------|---------|
| `splice/apps/app/src/test/resources/simple-topology-canton.conf` | Test topology reference |
| `splice/apps/app/src/test/resources/include/participants.conf` | Participant template |
| `splice/apps/app/src/test/resources/include/sequencers.conf` | Sequencer template |
| `splice/apps/app/src/test/resources/include/validators/_validator.conf` | Validator template |

### Documentation

| URL | Purpose |
|-----|---------|
| https://docs.sync.global/ | Canton Network docs |
| https://docs.digitalasset.com/build/3.4/quickstart/ | Quickstart guide |
| https://docs.digitalasset.com/build/3.4/ | Daml/Canton reference |
| https://docs.sync.global/app_dev/testing/localnet.html | LocalNet docs |

---

## Next Steps

Based on this research, the recommended next steps for the mg-localnet project are:

1. **Define Target User Experience**
   - What does the ideal CLI look like?
   - What does the ideal programmatic API look like?
   - What configuration format is most natural?

2. **Design Configuration Schema**
   - High-level YAML/JSON schema for topology definition
   - Mapping to HOCON generation
   - Validation and defaults

3. **Prototype Minimal LocalNet**
   - Single validator, single participant
   - Shared-secret auth
   - Verify can achieve same functionality with simpler setup

4. **Build State Query API**
   - Wrap existing JSON API endpoints
   - Provide clean interface for parties, users, contracts
   - Support export/import

5. **Integrate with Test Frameworks**
   - Testcontainers-style lifecycle
   - Deno/Node.js SDK
   - Clean setup/teardown for tests

---

*Research compiled from analysis of Splice LocalNet, CN-Quickstart, Canton documentation, and existing mg-localnet research documents.*
