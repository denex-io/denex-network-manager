# LocalNet Simplification Research

> [!WARNING]
> Historical research. It explains why this project exists, but the recommended implementation path
> was superseded by the current direct Docker API approach.

> Research document synthesizing findings about Canton Network LocalNet infrastructure to plan a simplified development environment.

**Date:** January 2026  
**Project:** mg-tokenization  
**Status:** Research Complete

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture](#current-architecture)
3. [Configuration Deep Dive](#configuration-deep-dive)
4. [Party and User Management](#party-and-user-management)
5. [Authentication Options](#authentication-options)
6. [Pain Points & Complexity Analysis](#pain-points--complexity-analysis)
7. [Simplification Opportunities](#simplification-opportunities)
8. [Key Questions for Planning](#key-questions-for-planning)
9. [Appendix: Key Files Reference](#appendix-key-files-reference)

---

## Executive Summary

The current LocalNet setup (Canton Quickstart) is a comprehensive but heavyweight development environment designed for production-like scenarios. For token-focused development on mg-tokenization, significant simplification opportunities exist:

### Key Findings

| Area | Current State | Simplification Potential |
|------|--------------|-------------------------|
| **Memory** | ~8GB minimum (canton 3GB + splice 3GB + postgres 2GB) | Could reduce to 2-4GB with single participant |
| **Containers** | 10+ services (canton, splice, postgres, nginx, keycloak, UIs) | Could reduce to 2-3 (canton, postgres, optional keycloak) |
| **Configuration** | 50+ env files, HOCON configs, shell scripts | Could centralize to single YAML + env file |
| **Participants** | 3 hardcoded (SV, App Provider, App User) | Often need only 1-2 for dev/testing |
| **Auth** | Full OAuth2 with Keycloak OR shared-secret | Shared-secret sufficient for local dev |
| **Party Setup** | Manual script-based, runtime resolution | Could pre-configure or auto-discover |

### Recommended Approach

1. **Short-term**: Create wrapper scripts that configure existing Quickstart with minimal profile
2. **Medium-term**: Use DAML Sandbox for simple contract testing, Canton Console for multi-participant
3. **Long-term**: Build simplified Docker Compose or consider Testcontainers integration

---

## Alternative Lightweight Options

Before diving into the current architecture, here are **officially supported lightweight alternatives** discovered during research:

### Option 1: DAML Sandbox (Simplest)

**Single command, in-memory, no auth required:**

```bash
# Start sandbox with JSON API
daml sandbox --dar myapp.dar --json-api-port 7575

# Or use daml start (includes sandbox + JSON API + Navigator)
daml start
```

| Aspect | Details |
|--------|---------|
| **Startup Time** | ~5 seconds |
| **Memory** | ~500MB-1GB |
| **Participants** | Single |
| **Storage** | In-memory (lost on restart) |
| **Auth** | None by default |
| **JSON API** | Included (port 7575) |
| **Use Case** | Rapid prototyping, unit tests, contract testing |

**Limitations:**
- Single participant only
- No Splice/Token Standard interfaces
- No persistent storage
- Not suitable for multi-party scenarios

### Option 2: Canton Console with In-Memory Storage

**Multi-participant with full control:**

```hocon
# config/dev-minimal.conf
canton {
  features {
    enable-testing-commands = yes
  }
  
  participants {
    admin {
      storage.type = memory
      ledger-api {
        port = 5011
        address = "0.0.0.0"
        auth-services = [{
          type = unsafe-jwt-hmac-256
          secret = "dev-secret"
        }]
      }
      http-ledger-api {
        port = 7575
        address = "0.0.0.0"
      }
      admin-api.port = 5012
    }
  }
  
  domains {
    local {
      storage.type = memory
      public-api.port = 5018
      admin-api.port = 5019
    }
  }
}
```

```bash
# Start Canton with minimal config
canton -c config/dev-minimal.conf
```

| Aspect | Details |
|--------|---------|
| **Startup Time** | ~15-30 seconds |
| **Memory** | ~1-2GB |
| **Participants** | Configurable (1+) |
| **Storage** | In-memory or PostgreSQL |
| **Auth** | Shared-secret (unsafe-jwt-hmac-256) |
| **JSON API** | Included |
| **Use Case** | Multi-participant testing, scriptable scenarios |

### Option 3: Quickstart Shared-Secret Mode (Current, Simplified)

**Full Canton Network without Keycloak:**

```bash
cd cn-quickstart/quickstart
make setup  # Choose: No OAuth2, No Observability
make build
make start
```

| Aspect | Details |
|--------|---------|
| **Startup Time** | 2-5 minutes |
| **Memory** | ~6-8GB |
| **Participants** | 3 (SV, App Provider, App User) |
| **Storage** | PostgreSQL (persistent) |
| **Auth** | Shared-secret JWT |
| **JSON API** | Ports 2975, 3975, 4975 |
| **Use Case** | Full integration testing, Token Standard compliance |

### Comparison Matrix

| Feature | DAML Sandbox | Canton Console | Quickstart (shared-secret) |
|---------|--------------|----------------|---------------------------|
| **Setup Complexity** | Trivial | Low | Medium |
| **Memory** | 500MB | 1-2GB | 6-8GB |
| **Startup** | 5s | 15-30s | 2-5min |
| **Multi-Participant** | No | Yes | Yes (3 fixed) |
| **Persistent Storage** | No | Optional | Yes |
| **Token Standard** | No | No | Yes |
| **Splice/Validators** | No | No | Yes |
| **Programmatic Control** | Limited | Good | Shell scripts |

---

## Current Architecture

### System Overview

```
                                 Canton Quickstart Architecture
                                 ==============================

    +-----------------------------------------------------------------+
    |                         Host Machine                             |
    +-----------------------------------------------------------------+
                                     |
    +------------------------Docker Network (quickstart)---------------+
    |                                                                   |
    |  +-----------+    +-----------+    +-----------+                 |
    |  |  Canton   |    |  Splice   |    | Postgres  |                 |
    |  | Container |    | Container |    | Container |                 |
    |  +-----------+    +-----------+    +-----------+                 |
    |       |                |                |                        |
    |  +----+----+      +----+----+      +----+----+                   |
    |  |SV Part. |      |SV Valid.|      |   DBs   |                   |
    |  |Port 4xxx|      |Port 4903|      | canton  |                   |
    |  +---------+      +---------+      | splice  |                   |
    |  |App Prov.|      |App Prov.|      | pqs     |                   |
    |  |Port 3xxx|      |Port 3903|      |keycloak |                   |
    |  +---------+      +---------+      +---------+                   |
    |  |App User |      |App User |                                    |
    |  |Port 2xxx|      |Port 2903|                                    |
    |  +---------+      +---------+                                    |
    |                                                                   |
    |  +-----------+    +-----------+    +-----------+                 |
    |  | Keycloak  |    |   nginx   |    |   UIs    |                 |
    |  | Port 8082 |    |  routing  |    | (wallet, |                 |
    |  +-----------+    +-----------+    |  ans,sv) |                 |
    |                                    +-----------+                 |
    +-------------------------------------------------------------------+

    Port Scheme:
    - 4xxx = Super Validator (SV)
    - 3xxx = App Provider  
    - 2xxx = App User
    
    Port Suffixes:
    - 901 = Ledger API (gRPC)
    - 902 = Admin API
    - 903 = Validator Admin API
    - 961 = gRPC Health Check
    - 975 = JSON API (HTTP)
    - 900 = HTTP Health Check
```

### Container Responsibilities

| Container | Role | Memory | What It Runs |
|-----------|------|--------|--------------|
| `canton` | Participant nodes | 3GB | 3 participant processes (SV, App Provider, App User) with Ledger API, Admin API, JSON API |
| `splice` | Validator nodes | 3GB | 3 validator processes connected to participants |
| `postgres` | Database | 2GB | Multiple databases for canton, splice, pqs, keycloak |
| `keycloak` | Auth (optional) | 512MB | OAuth2 identity provider with AppUser, AppProvider realms |
| `nginx` | Routing | 32MB | Reverse proxy for UIs at *.localhost domains |
| `splice-onboarding` | Setup | varies | One-time init: creates users, uploads DARs, shares config |
| `wallet-web-ui-*` | UI | 256MB each | Canton Coin wallet interfaces |
| `ans-web-ui-*` | UI | 256MB each | Canton Name Service interfaces |
| `sv-web-ui` | UI | 512MB | Super Validator admin interface |
| `scan-web-ui` | UI | 256MB | Transaction explorer |

### Data Flow

```
App Request Flow:
                                                    
  [Your App] --HTTP--> [JSON API :3975] --gRPC--> [Ledger API :3901]
                              |                          |
                              v                          v
                       [Auth Check]              [Canton Participant]
                              |                          |
                              v                          v
                       [Keycloak/                 [Splice Validator]
                        JWT verify]                      |
                                                        v
                                                 [Global Sync]
```

---

## Configuration Deep Dive

### Environment Variable Hierarchy

The configuration system is layered with multiple override levels:

```
Priority (lowest to highest):
1. compose.env files (module defaults)
2. common.env (shared settings)
3. Module-specific .env files
4. .env (project root)
5. .env.local (local overrides, gitignored)
6. Runtime exports
```

### Key Environment Variables

#### Profile Control
```bash
# Enable/disable participants (on/off)
SV_PROFILE=on
APP_PROVIDER_PROFILE=on
APP_USER_PROFILE=on

# Authentication mode
AUTH_MODE=oauth2  # or "shared-secret"

# Test mode flags
TEST_MODE=false
```

#### Port Configuration
```bash
# Port suffixes (combined with role prefix 2/3/4)
PARTICIPANT_LEDGER_API_PORT_SUFFIX=901   # e.g., 3901 for App Provider
PARTICIPANT_ADMIN_API_PORT_SUFFIX=902
PARTICIPANT_JSON_API_PORT_SUFFIX=975     # HTTP JSON API
VALIDATOR_ADMIN_API_PORT_SUFFIX=903

# UI Ports
APP_USER_UI_PORT=2000
APP_PROVIDER_UI_PORT=3000
SV_UI_PORT=4000
```

#### Database Configuration
```bash
DB_USER=cnadmin
DB_PASSWORD=supersafe
DB_SERVER=postgres
DB_PORT=5432
```

### HOCON Configuration Structure

Canton uses HOCON (Human-Optimized Config Object Notation) for participant configuration:

```hocon
# canton/app.conf - Main participant config
canton {
  features {
    enable-preview-commands = yes
    enable-testing-commands = yes
  }
  
  parameters {
    manual-start = no
    non-standard-config = yes
  }
}

_participant {
  storage = ${_storage}  # PostgreSQL config
  
  ledger-api {
    address = "0.0.0.0"
    port = 5001
    max-token-lifetime = Inf  # No token expiry for dev
  }
  
  http-ledger-api {
    port = 7575
    address = "0.0.0.0"
  }
  
  admin-api {
    address = "0.0.0.0"
    port = 5002
  }
}

# Include per-role configs
include file("/app/app-provider/on/app.conf")
include file("/app/app-user/on/app.conf")
include file("/app/sv/on/app.conf")
```

### Docker Compose Profiles

The compose setup uses Docker profiles to enable/disable functionality:

```yaml
# Example from compose.yaml
services:
  canton:
    profiles:
      - app-provider
      - app-user
      - sv
    # Runs only when at least one profile is active
    
  console:
    profiles:
      - console
    # Only runs with explicit --profile console
    
  swagger-ui:
    profiles:
      - swagger-ui
    # Optional documentation UI
```

---

## Party and User Management

### Party Allocation Flow

```
                    Party Creation Sequence
                    =======================

  [Participant Startup]
         |
         v
  [Canton creates namespace]  -->  Namespace ID: 1220abc...
         |
         v
  [splice-onboarding runs]
         |
         v
  [allocate_party() called]  -->  POST /v2/parties
         |                         {partyIdHint: "app_provider"}
         v
  [Party ID generated]       -->  app_provider::1220abc...
         |
         v
  [create_user() called]     -->  POST /v2/users
         |                         {userId, primaryParty}
         v
  [grant_rights() called]    -->  POST /v2/users/{id}/rights
         |                         {ActAs, ReadAs, ParticipantAdmin}
         v
  [Party ready for use]
```

### Key API Endpoints (JSON API v2)

```bash
# Allocate a new party
POST /v2/parties
{
  "partyIdHint": "my-party",
  "displayName": "My Party",
  "identityProviderId": ""
}

# Create a ledger user
POST /v2/users
{
  "user": {
    "id": "my-user",
    "primaryParty": "my-party::1220...",
    "isDeactivated": false,
    "metadata": {
      "annotations": {"username": "My User"}
    }
  },
  "rights": []
}

# Grant rights to user
POST /v2/users/{userId}/rights
{
  "rights": [
    {"kind": {"ParticipantAdmin": {"value": {}}}},
    {"kind": {"CanActAs": {"value": {"party": "..."}}}},
    {"kind": {"CanReadAs": {"value": {"party": "..."}}}}
  ]
}

# Get user details (including party)
GET /v2/users/{userId}
# Response: {"user": {"primaryParty": "..."}}

# Get participant namespace
GET /v2/parties/participant-id
# Response: {"participantId": "participant::1220..."}
```

### Shell Helper Functions

From `utils.sh`, these are the key functions for party/user management:

```bash
# Allocate party on participant
allocate_party(token, partyIdHint, participant) {
  # First checks if party exists
  # If not, creates via POST /v2/parties
}

# Create ledger user with primary party
create_user(token, userId, userName, party, participant) {
  # Creates user if doesn't exist (404 check)
  # Sets primaryParty mapping
}

# Grant rights (ParticipantAdmin, ActAs, ReadAs)
grant_rights(token, userId, partyId, rights, participant) {
  # Builds rights JSON array
  # POSTs to /v2/users/{userId}/rights
}

# Get party ID for a user
get_user_party(token, user, participant) {
  # GET /v2/users/{user}
  # Returns .user.primaryParty
}

# Upload DARs to participant
upload_dars(token, participant) {
  # Iterates /canton/dars/*.dar
  # POSTs each to /v2/packages
}
```

---

## Authentication Options

### Option 1: OAuth2 with Keycloak (Default)

Full OAuth2 implementation using Keycloak as identity provider.

```
                OAuth2 Authentication Flow
                ==========================

  [Client App]                     [Keycloak]              [JSON API]
       |                               |                        |
       |----(1) Token Request--------->|                        |
       |     grant_type=client_credentials                      |
       |     client_id=app-provider-validator                   |
       |     client_secret=...                                  |
       |                               |                        |
       |<---(2) Access Token-----------|                        |
       |     {access_token: "eyJ..."}                           |
       |                               |                        |
       |----(3) API Request + Bearer Token----------------->|
       |     Authorization: Bearer eyJ...                       |
       |                               |                        |
       |                               |<--(4) Verify JWT-------|
       |                               |     Check signature    |
       |                               |     Validate claims    |
       |                               |                        |
       |<---(5) Response------------------------------------|
```

**Keycloak Realms:**
- `AppProvider` - For app provider services and users
- `AppUser` - For app user services and users

**Pre-configured Clients:**

| Realm | Client ID | Purpose |
|-------|-----------|---------|
| AppProvider | `app-provider-validator` | Validator service auth |
| AppProvider | `app-provider-wallet` | Wallet UI |
| AppProvider | `app-provider-backend` | Backend services |
| AppUser | `app-user-validator` | Validator service auth |
| AppUser | `app-user-wallet` | Wallet UI |

**Token URL Pattern:**
```
http://keycloak.localhost:8082/realms/{realm}/protocol/openid-connect/token
```

### Option 2: Shared-Secret Mode (Simpler)

Uses HMAC-256 JWT signing with a static secret. No Keycloak required.

```bash
# Generate token with jwt-cli (included in splice-onboarding)
jwt-cli encode hs256 --s unsafe --p '{"sub": "admin", "aud": "https://sv.example.com"}'

# The secret "unsafe" is hardcoded for local development
# Tokens are validated by Canton using the same secret
```

**Configuration:**
```bash
# Enable shared-secret mode
AUTH_MODE=shared-secret

# In your app, generate tokens with:
SPLICE_APP_UI_UNSAFE=true
SPLICE_APP_UI_UNSAFE_SECRET=unsafe
```

**Advantages:**
- No Keycloak container needed (saves ~512MB RAM)
- Simpler debugging (tokens are predictable)
- Faster startup (no Keycloak initialization)

**Limitations:**
- Not suitable for production testing
- All tokens have same privileges
- No token expiry enforcement

### mg-tokenization Auth Configuration

The project supports both modes via configuration:

```typescript
// From asset-manager/src/shared/config.ts
export const BearerAuthConfig = z.object({
  BEARER_TOKEN: z.string(),
});

export const OAuthAuthConfig = z.object({
  OIDC_CONF_URL: z.string().url(),
  CLIENT_ID: z.string(),
  CLIENT_SECRET: z.string(),
  AUDIENCE: z.string(),
  ALLOW_INSECURE: z.coerce.boolean().default(false),
});

export const AuthConfig = z.union([
  OAuthAuthConfig,
  BearerAuthConfig,
]);
```

**E2E Test Credentials (from quickstart.ts):**
```typescript
const APP_USER_CREDENTIALS = {
  realm: "AppUser",
  clientId: "app-user-validator",
  clientSecret: "6m12QyyGl81d9nABWQXMycZdXho6ejEX",
};

const APP_PROVIDER_CREDENTIALS = {
  realm: "AppProvider",
  clientId: "app-provider-validator", 
  clientSecret: "AL8648b9SfdTFImq7FV56Vd0KHifHBuC",
};
```

**All Pre-configured Keycloak Clients:**

| Realm | Client ID | Secret | Purpose |
|-------|-----------|--------|---------|
| AppProvider | `app-provider-validator` | `AL8648b9SfdTFImq7FV56Vd0KHifHBuC` | Validator service |
| AppProvider | `app-provider-backend` | `05dmL9DAUmDnIlfoZ5EQ7pKskWmhBlNz` | Backend services |
| AppProvider | `app-provider-pqs` | (varies) | Participant Query Store |
| AppProvider | `app-provider-wallet` | public client | Wallet UI |
| AppProvider | `app-provider-ans` | public client | ANS UI |
| AppUser | `app-user-validator` | `6m12QyyGl81d9nABWQXMycZdXho6ejEX` | Validator service |
| AppUser | `app-user-pqs` | (varies) | Participant Query Store |
| AppUser | `app-user-wallet` | public client | Wallet UI |

---

## Pain Points & Complexity Analysis

### 1. Resource Consumption

| Issue | Impact | Details |
|-------|--------|---------|
| High memory baseline | Slow startup, laptop throttling | 8GB+ minimum: canton (3GB) + splice (3GB) + postgres (2GB) |
| Many containers | Docker overhead | 10+ containers even for simple dev |
| Cold start time | Developer friction | 2-5 minutes to fully healthy |

### 2. Configuration Complexity

| Issue | Impact | Details |
|-------|--------|---------|
| Scattered env files | Hard to understand | 50+ .env files across modules |
| HOCON + YAML + shell | Multiple syntaxes | Learning curve, debugging difficulty |
| Profile-based logic | Implicit behavior | `${APP_PROVIDER_PROFILE}` in paths |
| Runtime resolution | Late failures | Party IDs only known after startup |

### 3. Fixed Topology

| Issue | Impact | Details |
|-------|--------|---------|
| 3 participants hardcoded | Wasted resources | Often need only 1-2 for testing |
| SV always included | Splice overhead | Not needed for pure token dev |
| Profile=off still configures | Incomplete isolation | Configs still processed |

### 4. Data Extraction Challenges

| Issue | Impact | Details |
|-------|--------|---------|
| Party IDs runtime-generated | Manual discovery | Must query API after startup |
| Package IDs from upload | Not persisted | Lost on container restart |
| No single config export | Script-based | `share_file()` mechanism |

### 5. Testing Difficulties

| Issue | Impact | Details |
|-------|--------|---------|
| No programmatic control | Shell scripts only | Can't control from TypeScript tests |
| Cleanup is destructive | `make clean-all` | Loses all state |
| No isolated test runs | Shared state | Tests can interfere |

---

## Simplification Opportunities

### Opportunity 1: Single-File Configuration

Replace scattered env files with a single YAML configuration:

```yaml
# localnet-config.yaml
network:
  name: "dev-localnet"
  
participants:
  - name: app-provider
    port_prefix: 3
    memory_limit: 2g
    parties:
      - id: admin
        display_name: "Token Admin"
      - id: treasury
        display_name: "Treasury"
    users:
      - name: admin-user
        party: admin
        rights: [ParticipantAdmin, ActAs, ReadAs]
        
auth:
  mode: shared-secret  # or oauth2
  secret: "dev-secret"
  
database:
  type: postgres  # or in-memory for ephemeral
  
modules:
  keycloak: false
  pqs: false
  observability: false
  wallet_ui: false
```

### Opportunity 2: REST API for Management

Add a management API for programmatic control:

```
POST /api/v1/network/start
POST /api/v1/network/stop
GET  /api/v1/network/status
GET  /api/v1/network/config  # Export connection details

POST /api/v1/participants
GET  /api/v1/participants
GET  /api/v1/participants/:name

POST /api/v1/participants/:name/parties
GET  /api/v1/participants/:name/parties
GET  /api/v1/participants/:name/parties/:id

POST /api/v1/participants/:name/users
GET  /api/v1/participants/:name/users

POST /api/v1/participants/:name/packages
GET  /api/v1/participants/:name/packages
```

### Opportunity 3: Lightweight Container Image

Create a minimal Canton-only image for token development:

```dockerfile
# Minimal Canton for token development
FROM eclipse-temurin:21-jre

# Canton Community Edition only
COPY canton-community-*.jar /app/canton.jar

# Embedded database (H2) for ephemeral dev
# PostgreSQL for persistent dev

# Single participant configuration
COPY minimal.conf /app/canton.conf

# No Splice validators (not needed for tokens)
# No wallet UIs
# Optional Keycloak (shared-secret by default)

EXPOSE 3901 3902 3975
CMD ["java", "-jar", "/app/canton.jar", "daemon", "-c", "/app/canton.conf"]
```

**Estimated resources:** 1-2GB RAM, <30s startup

### Opportunity 4: Testcontainers Integration

Create a Deno/Node library for programmatic control:

```typescript
// Proposed API for mg-tokenization
import { LocalNet } from "@mg-token/localnet";

describe("Token E2E", () => {
  let network: LocalNet;
  
  beforeAll(async () => {
    network = await LocalNet.start({
      participants: ["app-provider"],
      auth: "shared-secret",
      ephemeral: true,  // In-memory database
    });
    
    // Auto-discovers and exposes
    console.log(network.jsonApiUrl);  // http://localhost:XXXXX
    console.log(network.adminParty);  // app-provider::1220...
  });
  
  afterAll(async () => {
    await network.stop();
  });
  
  test("mint tokens", async () => {
    const dar = await network.uploadDar("./my-tokens.dar");
    const ledger = network.getLedgerClient();
    // ...
  });
});
```

### Opportunity 5: Pre-configured Development Profiles

Create named profiles for common scenarios:

```bash
# Single participant, ephemeral, no auth
./localnet start --profile minimal

# Two participants for transfer testing
./localnet start --profile transfer-test

# Full setup matching production topology
./localnet start --profile production-like

# Custom configuration
./localnet start --config ./my-localnet.yaml
```

---

## Key Questions for Planning

### Architecture Questions

1. **Do we need all 3 participants?**
   - For token minting/burning: 1 participant (App Provider) is sufficient
   - For transfers between parties: 1 participant with multiple parties works
   - For cross-participant transfers: Need 2 participants minimum
   - SV participant: Only needed for global sync features (Canton Coin, ANS)

2. **Can we skip Splice validators?**
   - For CIP-56 Token Standard: Splice is required (provides interfaces)
   - For pure DAML contracts: Canton only would work
   - Trade-off: Smaller footprint vs. Token Standard compatibility

3. **Is Canton's sandbox/test mode sufficient?**
   - Canton has `daml sandbox` for quick testing
   - Limitations: Single participant, in-memory only
   - Could work for unit tests, not E2E

### Configuration Questions

4. **What's the minimum viable topology for E2E testing?**
   - Recommendation: 1 participant with 2 parties (admin + user)
   - Memory: ~2GB vs 8GB+ for full Quickstart
   - Startup: ~30s vs 2-5 minutes

5. **Should auth be optional for pure local dev?**
   - Shared-secret mode is already simpler than OAuth2
   - Could add "no-auth" mode for initial development
   - Security trade-off acceptable for localhost-only

### Implementation Questions

6. **Build new tooling or wrap existing?**
   - Short-term: Shell scripts wrapping Quickstart with minimal profiles
   - Medium-term: Simplified Docker Compose (subset of Quickstart)
   - Long-term: Testcontainers-style library

7. **How to handle persistent vs. ephemeral state?**
   - Ephemeral: In-memory H2 database (fast, but loses state)
   - Persistent: PostgreSQL with named volumes
   - Recommendation: Default ephemeral, option for persistent

8. **What data needs to be extractable?**
   - Must have: JSON API URL, auth credentials
   - Must have: Admin party ID
   - Should have: Package ID after DAR upload
   - Nice to have: All party IDs, user mappings

---

## Appendix: Key Files Reference

### cn-quickstart/quickstart/

| Path | Purpose |
|------|---------|
| `compose.yaml` | Main Docker Compose entry point |
| `.env` | Root environment variables |
| `Makefile` | Build and management commands |

### cn-quickstart/quickstart/docker/modules/

| Module | Path | Purpose |
|--------|------|---------|
| LocalNet | `localnet/compose.yaml` | Core Canton/Splice containers |
| LocalNet | `localnet/compose.env` | LocalNet defaults |
| LocalNet | `localnet/env/*.env` | Per-role environment |
| LocalNet | `localnet/conf/canton/app.conf` | Canton HOCON config |
| LocalNet | `localnet/resource-constraints.yaml` | Memory limits |
| Keycloak | `keycloak/compose.yaml` | OAuth2 provider |
| Keycloak | `keycloak/conf/data/*.json` | Realm exports |
| Onboarding | `splice-onboarding/compose.yaml` | Init container |
| Onboarding | `splice-onboarding/docker/utils.sh` | Helper functions |
| PQS | `pqs/` | Participant Query Store |
| Observability | `observability/` | Grafana/Prometheus |

### mg-tokenization/asset-manager/

| Path | Purpose |
|------|---------|
| `src/shared/config.ts` | Zod config schemas |
| `src/ledger/sdk-client.ts` | SDK client factory |
| `src/test/e2e/quickstart.ts` | Quickstart helper for E2E |
| `src/test/e2e/ledger-client.ts` | E2E ledger client factory |

### mg-tokenization/config/

| Path | Purpose |
|------|---------|
| `localnet.env.example` | General LocalNet config template |
| `localnet-oauth.env.example` | OAuth mode template |
| `localnet-bearer.env.example` | Bearer token mode template |

### mg-tokenization/scripts/

| Path | Purpose |
|------|---------|
| `start-localnet.sh` | Start Quickstart wrapper |
| `stop-localnet.sh` | Stop Quickstart wrapper |
| `check-localnet.sh` | Health check wrapper |
| `upload-dar.sh` | DAR upload with auto-auth |

---

## Next Steps

Based on this research, recommended next steps organized by timeframe:

### Immediate (This Week)

1. **Create minimal profile script** (`scripts/start-localnet-minimal.sh`)
   ```bash
   # Start Quickstart with only App Provider participant
   export APP_USER_PROFILE=off
   export SV_PROFILE=off
   export OBSERVABILITY_ENABLED=false
   make start
   ```
   - Reduces memory from 8GB to ~4GB
   - Faster startup (fewer containers)
   - Sufficient for token minting/burning tests

2. **Document shared-secret setup** 
   - Update `AGENTS.md` with shared-secret auth option
   - Create `config/localnet-shared-secret.env.example`
   - Simplifies initial developer onboarding

3. **Build config exporter** (`scripts/export-localnet-config.sh`)
   ```bash
   # Output JSON with all connection details after startup
   {
     "jsonApiUrl": "http://localhost:3975",
     "adminParty": "app_provider::1220...",
     "packageId": "5f8c316c...",
     "authMode": "shared-secret",
     "keycloakUrl": "http://localhost:8082"
   }
   ```

### Short-term (Next 2-4 Weeks)

4. **Evaluate DAML Sandbox for unit tests**
   - Test if `daml sandbox` can run token contracts without Splice
   - If yes: Use for fast unit tests (~5s startup)
   - If no: Document limitations

5. **Create Canton Console config for integration tests**
   - `config/canton-dev.conf` with in-memory storage
   - Two participants (admin + user) for transfer testing
   - ~30s startup, ~2GB memory

### Medium-term (1-2 Months)

6. **Simplified Docker Compose** (`docker/dev-localnet/`)
   - Subset of Quickstart optimized for token development
   - Single participant + PostgreSQL + optional Keycloak
   - Target: 2GB memory, 30s startup

7. **Testcontainers spike** 
   - Evaluate wrapping Canton in Deno-compatible Testcontainers
   - Would enable fully programmatic test setup
   - Similar pattern to existing `quickstart.ts` but with container lifecycle control

### Reference Implementation

For immediate use, here's a minimal Quickstart configuration:

```bash
# scripts/start-localnet-minimal.sh
#!/bin/bash
cd "${CN_QUICKSTART_DIR}/quickstart"

# Disable unnecessary services
export SV_PROFILE=off
export APP_USER_PROFILE=off  
export OBSERVABILITY_ENABLED=false

# Use shared-secret auth (no Keycloak)
# Uncomment for even lighter setup:
# export AUTH_MODE=shared-secret

make start
```

---

## References

### Official Documentation
- [Canton Getting Started](https://docs.digitalasset.com/operate/3.4/tutorials/getting_started.html)
- [DAML Sandbox](https://docs.digitalasset.com/build/3.4/component-howtos/application-development/daml-sandbox.html)
- [Canton Storage Configuration](https://docs.digitalasset.com/operate/3.4/howtos/configure/storage/storage.html)
- [Canton API Configuration](https://docs.daml.com/canton/usermanual/apis.html)
- [Canton Console](https://docs.digitalasset.com/operate/3.4/howtos/operate/console/console.html)
- [Splice LocalNet](https://docs.sync.global/app_dev/testing/localnet.html)

### GitHub Repositories
- [Canton Quickstart](https://github.com/digital-asset/cn-quickstart)
- [Splice](https://github.com/hyperledger-labs/splice)

---

*Research compiled from cn-quickstart codebase analysis, Splice LocalNet documentation, Canton official docs, and mg-tokenization project structure.*
