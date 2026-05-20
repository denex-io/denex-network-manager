# LocalNet Tooling Specification

> A specification for a tooling layer that simplifies Canton Network LocalNet configuration and provides runtime discovery for mg-tokenization development.

**Version:** 1.0  
**Date:** January 2026  
**Status:** Specification

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [localnet.yaml Schema](#3-localnetyaml-schema)
4. [CLI Specification](#4-cli-specification)
5. [Discovery API Specification](#5-discovery-api-specification)
6. [Generation Logic](#6-generation-logic)
7. [Discovery Logic](#7-discovery-logic)
8. [Integration with asset-manager](#8-integration-with-asset-manager)
9. [Implementation Approach](#9-implementation-approach)
10. [Usage Examples](#10-usage-examples)

---

## 1. Problem Statement

### Configuration Complexity

Canton Network Quickstart (cn-quickstart) provides a comprehensive development environment, but its configuration complexity creates significant developer friction:

| Category | Count | Description |
|----------|-------|-------------|
| Environment files | **37** | Scattered across modules with layered overrides |
| HOCON configs | **34** | Canton/Splice participant configuration |
| Docker Compose files | **6+** | Modular composition with profiles |
| Keycloak realm JSONs | **2** | 4,621 lines combined (not human-writable) |
| **Total config files** | **135+** | Spanning 6 modules |

### Example Pain Point: Keycloak Realm JSON

The current Keycloak realm files are exports, not human-authored configurations:

```json
// AppUser-realm.json - 2,309 lines including:
{
  "id" : "6e72bec3-79a3-4faa-932e-0e261ee04aeb",  // Generated UUID
  "realm" : "AppUser",
  "roles" : {
    "realm" : [ {
      "id" : "6bbfc5b2-8dc3-490e-9a96-621191b6fb4f",  // Generated UUID
      "name" : "uma_authorization",
      "containerId" : "6e72bec3-79a3-4faa-932e-0e261ee04aeb",  // Reference
      // ... 50+ lines per role
    }]
  },
  "clients" : [
    // 12 clients, each 50-100 lines with generated UUIDs
  ],
  "clientScopes" : [
    // 15 scopes with protocol mappers
  ]
  // ... hundreds more lines of defaults
}
```

**To add one new OAuth client**, a developer must:
1. Manually edit 2,300+ line JSON file
2. Generate new UUIDs for all references
3. Ensure client scope mappings are correct
4. Restart Keycloak and hope for no import errors

### Example Pain Point: Environment Variable Cross-References

Environment variables are scattered across 37 files with layered overrides:

```
.env                                    # Root: DAML_RUNTIME_VERSION, SPLICE_VERSION
.env.local                             # Local: AUTH_MODE, PARTY_HINT
modules/localnet/env/common.env        # Ports: PARTICIPANT_*_PORT_SUFFIX
modules/localnet/env/app-provider-auth-on.env  # Party hints, audiences
modules/keycloak/env/app-provider/on/oauth2.env  # OAuth URLs, client IDs
modules/keycloak/env/app-user/on/oauth2.env      # Different realm, same pattern
```

A single configuration change may require edits to 3-5 files.

### Runtime-Generated Identifiers

**Party IDs are only known after startup:**
```
# Before startup: We define a hint
APP_PROVIDER_PARTY_HINT=app_provider_quickstart-mgaare-1

# After startup: Canton generates the full ID with namespace
app_provider_quickstart-mgaare-1::1220e46903d02f76f0911c27dc2d29d4211b3fae7a2300db223f4074c5b59bdedc1b
                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                  Runtime-generated namespace (changes on clean restart)
```

**Package IDs are only known after DAR upload:**
```typescript
// Currently hardcoded in asset-manager/src/shared/template-ids.ts
const TOKEN_MANAGER_PACKAGE_ID = "5f8c316c1752ac1bbb0cf38b38d25a6ae8b9894b22faf9a72f507819603997f1";
// Must be manually updated after every DAML rebuild!
```

### No Single Source of Truth

Currently, to run asset-manager against LocalNet, developers must:

1. Start LocalNet: `./scripts/start-localnet.sh`
2. Wait for services (no readiness indicator)
3. Upload DAR: `./scripts/upload-dar.sh` 
4. Query party ID: Manual API call or copy from logs
5. Get package ID: Extract from DAR upload response
6. Update `.env` file with party ID
7. Update `template-ids.ts` with package ID (if changed)
8. Restart asset-manager

**There is no API for apps to query "what's running and how do I connect?"**

---

## 2. Goals & Non-Goals

### Goals

| Goal | Description |
|------|-------------|
| **Single config file** | Replace 37 env files with one human-readable `localnet.yaml` (~50 lines) |
| **Keycloak generation** | Generate minimal realm JSON from simple client/user definitions |
| **Runtime discovery** | REST API to query party IDs, package IDs, connection info |
| **CLI commands** | `localnet` command for common operations |
| **Integration-ready** | Output suitable for asset-manager and conflib consumption |

### Non-Goals

| Non-Goal | Rationale |
|----------|-----------|
| Replace cn-quickstart | We wrap and extend it, not replace |
| Support shared-secret auth | OAuth2 with Keycloak is required for production parity |
| Reduce resource usage | 8GB minimum is acceptable for local dev |
| Manage Canton internals | We don't modify Canton/Splice HOCON configs |
| Production deployment | This is dev tooling only |

---

## 3. localnet.yaml Schema

### Complete Schema Definition

```yaml
# localnet.yaml - Human-authored LocalNet configuration
# Location: project root or $LOCALNET_CONFIG_PATH

version: "1.0"

# cn-quickstart location (auto-detected if not specified)
quickstart:
  path: "${CN_QUICKSTART_DIR}"  # Supports env var expansion
  # Or explicit path: path: "/Users/me/cn-quickstart"

# Keycloak configuration
keycloak:
  url: "http://localhost:8082"
  admin_user: "admin"
  admin_password: "admin"
  audience: "https://canton.network.global"

# Participant configuration
participants:
  app-user:
    enabled: true
    json_api_port: 2975
    ledger_api_port: 2901
    admin_api_port: 2902
    realm: "AppUser"
    party_hint: "app_user"
    
  app-provider:
    enabled: true
    json_api_port: 3975
    ledger_api_port: 3901
    admin_api_port: 3902
    realm: "AppProvider"
    party_hint: "app_provider"
    
  sv:
    enabled: false  # Disable SV for token development
    json_api_port: 4975
    ledger_api_port: 4901
    admin_api_port: 4902
    realm: "SV"
    party_hint: "sv"

# Keycloak clients to create/manage
clients:
  # Service account for backend services (confidential client)
  app-provider-validator:
    realm: "AppProvider"
    service_account: true
    client_secret: "AL8648b9SfdTFImq7FV56Vd0KHifHBuC"  # Can be auto-generated
    
  app-user-validator:
    realm: "AppUser"
    service_account: true
    client_secret: "6m12QyyGl81d9nABWQXMycZdXho6ejEX"
    
  # Public client for frontend apps
  token-manager-ui:
    realm: "AppProvider"
    service_account: false
    public: true
    redirect_uris:
      - "http://localhost:5173/*"
      - "http://127.0.0.1:5173/*"
    web_origins:
      - "http://localhost:5173"
      - "http://127.0.0.1:5173"

# DAR packages to upload after startup
packages:
  - name: "token-manager-v1"
    dar_path: "daml/token-manager-v1/.daml/dist/token-manager-v1-1.0.0.dar"
    upload_to:
      - "app-provider"
      - "app-user"
      
  - name: "token-standard"
    dar_path: "dependencies/splice-token-standard-1.0.0.dar"
    upload_to:
      - "app-provider"
      - "app-user"

# Discovery server configuration
discovery:
  port: 3100
  host: "127.0.0.1"
  cache_ttl_seconds: 300  # Cache party/package IDs for 5 minutes
```

### Minimal Configuration Example

For simple token development with single participant:

```yaml
version: "1.0"

participants:
  app-provider:
    enabled: true
    
clients:
  app-provider-validator:
    realm: "AppProvider"
    service_account: true

packages:
  - name: "token-manager-v1"
    dar_path: "daml/token-manager-v1/.daml/dist/token-manager-v1-1.0.0.dar"
    upload_to: ["app-provider"]
```

All other values use sensible defaults.

### Schema Validation (Zod)

```typescript
import { z } from "zod";

const ParticipantSchema = z.object({
  enabled: z.boolean().default(true),
  json_api_port: z.number().int().min(1).max(65535),
  ledger_api_port: z.number().int().min(1).max(65535).optional(),
  admin_api_port: z.number().int().min(1).max(65535).optional(),
  realm: z.string(),
  party_hint: z.string().optional(),
});

const ClientSchema = z.object({
  realm: z.string(),
  service_account: z.boolean().default(false),
  public: z.boolean().default(false),
  client_secret: z.string().optional(),
  redirect_uris: z.array(z.string()).optional(),
  web_origins: z.array(z.string()).optional(),
});

const PackageSchema = z.object({
  name: z.string(),
  dar_path: z.string(),
  upload_to: z.array(z.string()),
});

const LocalnetConfigSchema = z.object({
  version: z.literal("1.0"),
  quickstart: z.object({
    path: z.string().optional(),
  }).optional(),
  keycloak: z.object({
    url: z.string().url().default("http://localhost:8082"),
    admin_user: z.string().default("admin"),
    admin_password: z.string().default("admin"),
    audience: z.string().default("https://canton.network.global"),
  }).optional(),
  participants: z.record(z.string(), ParticipantSchema).default({
    "app-provider": {
      enabled: true,
      json_api_port: 3975,
      realm: "AppProvider",
    },
  }),
  clients: z.record(z.string(), ClientSchema).optional(),
  packages: z.array(PackageSchema).optional(),
  discovery: z.object({
    port: z.number().int().default(3100),
    host: z.string().default("127.0.0.1"),
    cache_ttl_seconds: z.number().int().default(300),
  }).optional(),
});

export type LocalnetConfig = z.infer<typeof LocalnetConfigSchema>;
```

---

## 4. CLI Specification

### Command Overview

```
localnet - Canton Network LocalNet management tool

USAGE:
    localnet <COMMAND> [OPTIONS]

COMMANDS:
    generate    Generate configs from localnet.yaml
    start       Start LocalNet (wraps cn-quickstart)
    stop        Stop LocalNet
    status      Check health of all services
    parties     Discover and display party IDs
    packages    List uploaded package IDs
    env         Generate environment configuration
    serve       Start discovery API server
    
OPTIONS:
    -c, --config <PATH>    Config file path [default: ./localnet.yaml]
    -v, --verbose          Enable verbose output
    -h, --help             Print help
    --version              Print version
```

### Command Details

#### `localnet generate`

Generate low-level configuration files from `localnet.yaml`.

```
localnet generate [OPTIONS]

OPTIONS:
    --keycloak             Generate Keycloak realm JSON files
    --env                  Generate .env files for cn-quickstart
    --compose              Generate docker-compose.override.yaml
    --all                  Generate all (default)
    --output-dir <DIR>     Output directory [default: .localnet/generated]
    --dry-run              Show what would be generated without writing

EXAMPLES:
    localnet generate                    # Generate all configs
    localnet generate --keycloak         # Only regenerate Keycloak realms
    localnet generate --dry-run          # Preview generation
```

**Output Structure:**
```
.localnet/
├── generated/
│   ├── keycloak/
│   │   ├── AppProvider-realm.json    # Minimal realm (not 2300 lines!)
│   │   ├── AppUser-realm.json
│   │   └── README.md
│   ├── env/
│   │   ├── localnet.env              # Merged env for cn-quickstart
│   │   └── auth.env                  # OAuth credentials
│   └── docker-compose.override.yaml  # Profile overrides
└── state/
    ├── parties.json                   # Discovered party IDs (after startup)
    └── packages.json                  # Uploaded package IDs
```

#### `localnet start`

Start LocalNet with generated configuration.

```
localnet start [OPTIONS]

OPTIONS:
    --generate             Run generate before start [default: true]
    --no-generate          Skip generation (use existing configs)
    --wait                 Wait for all services to be healthy [default: true]
    --timeout <SECONDS>    Health check timeout [default: 300]
    --upload-packages      Upload packages after startup [default: true]

EXAMPLES:
    localnet start                     # Generate, start, wait, upload
    localnet start --no-generate       # Use existing configs
    localnet start --timeout 600       # Longer timeout for slow machines
```

#### `localnet stop`

Stop LocalNet services.

```
localnet stop [OPTIONS]

OPTIONS:
    --clean                Also remove containers and volumes
    
EXAMPLES:
    localnet stop                      # Stop services
    localnet stop --clean              # Stop and remove all data
```

#### `localnet status`

Check health of all services.

```
localnet status [OPTIONS]

OPTIONS:
    -f, --format <FORMAT>  Output format: text, json [default: text]
    --watch                Continuously monitor (refresh every 5s)
    
EXAMPLES:
    localnet status                    # Quick health check
    localnet status --format json      # JSON output for scripts
    localnet status --watch            # Monitor until Ctrl+C

OUTPUT (text):
    LocalNet Status
    ===============
    
    Participants:
      [OK] app-provider (JSON API: http://localhost:3975)
      [OK] app-user (JSON API: http://localhost:2975)
      [--] sv (disabled)
    
    Services:
      [OK] Keycloak (http://localhost:8082)
      [OK] PostgreSQL (localhost:5432)
    
    Discovery:
      [OK] API server (http://localhost:3100)
    
    All services healthy!

OUTPUT (json):
    {
      "healthy": true,
      "participants": {
        "app-provider": { "healthy": true, "json_api_url": "http://localhost:3975" },
        "app-user": { "healthy": true, "json_api_url": "http://localhost:2975" }
      },
      "services": {
        "keycloak": { "healthy": true, "url": "http://localhost:8082" },
        "postgres": { "healthy": true }
      }
    }
```

#### `localnet parties`

Discover and display party IDs.

```
localnet parties [OPTIONS]

OPTIONS:
    -f, --format <FORMAT>  Output format: text, json, env [default: text]
    --participant <NAME>   Show only specific participant
    
EXAMPLES:
    localnet parties                   # List all parties
    localnet parties --format json     # JSON for programmatic use
    localnet parties --format env      # ENV format for shell export

OUTPUT (text):
    Discovered Parties
    ==================
    
    Participant: app-provider
      Party ID: app_provider_quickstart-mgaare-1::1220e469...
      User ID: ledger-api-user
    
    Participant: app-user
      Party ID: app_user_quickstart-mgaare-1::1220f571...
      User ID: ledger-api-user

OUTPUT (env):
    APP_PROVIDER_PARTY=app_provider_quickstart-mgaare-1::1220e469...
    APP_USER_PARTY=app_user_quickstart-mgaare-1::1220f571...
```

#### `localnet packages`

List uploaded package IDs.

```
localnet packages [OPTIONS]

OPTIONS:
    -f, --format <FORMAT>  Output format: text, json, env [default: text]
    --name <NAME>          Show only specific package
    
EXAMPLES:
    localnet packages                  # List all packages
    localnet packages --name token-manager-v1

OUTPUT (text):
    Uploaded Packages
    =================
    
    token-manager-v1
      Package ID: 5f8c316c1752ac1bbb0cf38b38d25a6ae8b9894b22faf9a72f507819603997f1
      Uploaded to: app-provider, app-user
    
    token-standard
      Package ID: a1b2c3d4e5f6...
      Uploaded to: app-provider, app-user

OUTPUT (env):
    TOKEN_MANAGER_V1_PACKAGE_ID=5f8c316c1752ac1bbb0cf38b38d25a6ae8b9894b22faf9a72f507819603997f1
```

#### `localnet env`

Generate environment configuration for an application.

```
localnet env <PARTICIPANT> [OPTIONS]

ARGUMENTS:
    <PARTICIPANT>          Participant name (app-provider, app-user)

OPTIONS:
    -f, --format <FORMAT>  Output format: dotenv, json, ts [default: dotenv]
    -o, --output <PATH>    Write to file instead of stdout
    --for <APP>            Generate for specific app: asset-manager, custom
    
EXAMPLES:
    localnet env app-provider                    # Print .env content
    localnet env app-provider -o .env            # Write to .env file
    localnet env app-provider --format json      # JSON format
    localnet env app-provider --for asset-manager  # asset-manager specific

OUTPUT (dotenv):
    # Generated by localnet env - do not edit
    # Generated at: 2026-01-16T20:00:00Z
    
    # -- Server Configuration
    SERVER_PORT=8080
    SERVER_HOST=0.0.0.0
    
    # -- Ledger Configuration
    LEDGER_API_URL=http://localhost:3975
    
    # -- Registry Configuration (discovered)
    REGISTRY_PARTY=app_provider_quickstart-mgaare-1::1220e469...
    
    # -- Authentication (OAuth2)
    AUTH_OIDC_CONF_URL=http://localhost:8082/realms/AppProvider/.well-known/openid-configuration
    AUTH_CLIENT_ID=app-provider-validator
    AUTH_CLIENT_SECRET=AL8648b9SfdTFImq7FV56Vd0KHifHBuC
    AUTH_AUDIENCE=https://canton.network.global
    AUTH_ALLOW_INSECURE=true

OUTPUT (ts):
    // Generated by localnet env - do not edit
    export const LEDGER_API_URL = "http://localhost:3975";
    export const REGISTRY_PARTY = "app_provider_quickstart-mgaare-1::1220e469...";
    export const TOKEN_MANAGER_PACKAGE_ID = "5f8c316c1752ac1bbb0cf38b38d25a6ae8b9894b22faf9a72f507819603997f1";
```

#### `localnet serve`

Start the discovery API server.

```
localnet serve [OPTIONS]

OPTIONS:
    -p, --port <PORT>      Server port [default: 3100]
    -h, --host <HOST>      Server host [default: 127.0.0.1]
    --background           Run in background (daemonize)
    
EXAMPLES:
    localnet serve                     # Start on default port
    localnet serve --port 3200         # Custom port
    localnet serve --background        # Run as daemon
```

---

## 5. Discovery API Specification

### Base URL

```
http://localhost:3100
```

### Endpoints

#### `GET /discovery/status`

Health check for all LocalNet services.

**Response:**
```json
{
  "healthy": true,
  "timestamp": "2026-01-16T20:00:00.000Z",
  "participants": {
    "app-provider": {
      "enabled": true,
      "healthy": true,
      "json_api_url": "http://localhost:3975",
      "ledger_api_url": "http://localhost:3901",
      "realm": "AppProvider"
    },
    "app-user": {
      "enabled": true,
      "healthy": true,
      "json_api_url": "http://localhost:2975",
      "ledger_api_url": "http://localhost:2901",
      "realm": "AppUser"
    },
    "sv": {
      "enabled": false,
      "healthy": null
    }
  },
  "services": {
    "keycloak": {
      "healthy": true,
      "url": "http://localhost:8082"
    },
    "postgres": {
      "healthy": true,
      "port": 5432
    }
  }
}
```

#### `GET /discovery/parties`

Get all discovered party IDs.

**Response:**
```json
{
  "parties": {
    "app-provider": {
      "party_id": "app_provider_quickstart-mgaare-1::1220e46903d02f76f0911c27dc2d29d4211b3fae7a2300db223f4074c5b59bdedc1b",
      "party_hint": "app_provider_quickstart-mgaare-1",
      "user_id": "ledger-api-user",
      "participant": "app-provider"
    },
    "app-user": {
      "party_id": "app_user_quickstart-mgaare-1::1220f57123...",
      "party_hint": "app_user_quickstart-mgaare-1",
      "user_id": "ledger-api-user",
      "participant": "app-user"
    }
  },
  "cached_at": "2026-01-16T20:00:00.000Z",
  "cache_ttl_seconds": 300
}
```

#### `GET /discovery/parties/:participant`

Get party ID for a specific participant.

**Parameters:**
- `participant` - Participant name (e.g., `app-provider`)

**Response:**
```json
{
  "party_id": "app_provider_quickstart-mgaare-1::1220e46903d02f76f0911c27dc2d29d4211b3fae7a2300db223f4074c5b59bdedc1b",
  "party_hint": "app_provider_quickstart-mgaare-1",
  "user_id": "ledger-api-user",
  "participant": "app-provider"
}
```

**Errors:**
- `404 Not Found` - Participant not found or not enabled
- `503 Service Unavailable` - Participant not healthy

#### `GET /discovery/packages`

List all uploaded packages.

**Response:**
```json
{
  "packages": {
    "token-manager-v1": {
      "package_id": "5f8c316c1752ac1bbb0cf38b38d25a6ae8b9894b22faf9a72f507819603997f1",
      "name": "token-manager-v1",
      "version": "1.0.0",
      "uploaded_to": ["app-provider", "app-user"],
      "uploaded_at": "2026-01-16T19:55:00.000Z"
    },
    "splice-token-standard": {
      "package_id": "a1b2c3d4e5f6...",
      "name": "splice-token-standard",
      "version": "1.0.0",
      "uploaded_to": ["app-provider", "app-user"],
      "uploaded_at": "2026-01-16T19:50:00.000Z"
    }
  },
  "cached_at": "2026-01-16T20:00:00.000Z"
}
```

#### `GET /discovery/packages/:name`

Get package ID for a specific package.

**Parameters:**
- `name` - Package name (e.g., `token-manager-v1`)

**Response:**
```json
{
  "package_id": "5f8c316c1752ac1bbb0cf38b38d25a6ae8b9894b22faf9a72f507819603997f1",
  "name": "token-manager-v1",
  "version": "1.0.0",
  "uploaded_to": ["app-provider", "app-user"],
  "uploaded_at": "2026-01-16T19:55:00.000Z"
}
```

#### `GET /discovery/env/:participant`

Generate ready-to-use environment configuration.

**Parameters:**
- `participant` - Participant name (e.g., `app-provider`)

**Query Parameters:**
- `format` - Output format: `dotenv` (default), `json`, `shell`

**Response (format=dotenv):**
```
Content-Type: text/plain

# Generated by localnet discovery API
LEDGER_API_URL=http://localhost:3975
REGISTRY_PARTY=app_provider_quickstart-mgaare-1::1220e469...
AUTH_OIDC_CONF_URL=http://localhost:8082/realms/AppProvider/.well-known/openid-configuration
AUTH_CLIENT_ID=app-provider-validator
AUTH_CLIENT_SECRET=AL8648b9SfdTFImq7FV56Vd0KHifHBuC
AUTH_AUDIENCE=https://canton.network.global
TOKEN_MANAGER_V1_PACKAGE_ID=5f8c316c1752ac1bbb0cf38b38d25a6ae8b9894b22faf9a72f507819603997f1
```

**Response (format=json):**
```json
{
  "ledger": {
    "api_url": "http://localhost:3975"
  },
  "registry": {
    "party": "app_provider_quickstart-mgaare-1::1220e469..."
  },
  "auth": {
    "oidc_conf_url": "http://localhost:8082/realms/AppProvider/.well-known/openid-configuration",
    "client_id": "app-provider-validator",
    "client_secret": "AL8648b9SfdTFImq7FV56Vd0KHifHBuC",
    "audience": "https://canton.network.global"
  },
  "packages": {
    "token-manager-v1": "5f8c316c1752ac1bbb0cf38b38d25a6ae8b9894b22faf9a72f507819603997f1"
  }
}
```

#### `POST /discovery/invalidate`

Clear discovery cache and re-fetch all data.

**Response:**
```json
{
  "invalidated": true,
  "timestamp": "2026-01-16T20:05:00.000Z"
}
```

### OpenAPI Schema

```yaml
openapi: 3.0.3
info:
  title: LocalNet Discovery API
  version: 1.0.0
  description: Runtime discovery for Canton Network LocalNet

servers:
  - url: http://localhost:3100
    description: Local development

paths:
  /discovery/status:
    get:
      summary: Health check all services
      responses:
        '200':
          description: Service status
          
  /discovery/parties:
    get:
      summary: Get all party IDs
      responses:
        '200':
          description: Party information
          
  /discovery/parties/{participant}:
    get:
      summary: Get party ID for participant
      parameters:
        - name: participant
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Party information
        '404':
          description: Participant not found
          
  /discovery/packages:
    get:
      summary: List all packages
      responses:
        '200':
          description: Package information
          
  /discovery/packages/{name}:
    get:
      summary: Get package by name
      parameters:
        - name: name
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Package information
        '404':
          description: Package not found
          
  /discovery/env/{participant}:
    get:
      summary: Generate environment config
      parameters:
        - name: participant
          in: path
          required: true
          schema:
            type: string
        - name: format
          in: query
          schema:
            type: string
            enum: [dotenv, json, shell]
            default: dotenv
      responses:
        '200':
          description: Environment configuration
          
  /discovery/invalidate:
    post:
      summary: Clear discovery cache
      responses:
        '200':
          description: Cache invalidated
```

---

## 6. Generation Logic

### Overview

The generator reads `localnet.yaml` and produces:

1. **Minimal Keycloak realm JSON** - Only clients and users, no UUIDs
2. **Merged .env files** - Single file for cn-quickstart
3. **docker-compose.override.yaml** - Profile overrides if needed

### Keycloak Realm Generation

#### Input (from localnet.yaml)

```yaml
clients:
  app-provider-validator:
    realm: "AppProvider"
    service_account: true
    client_secret: "AL8648b9SfdTFImq7FV56Vd0KHifHBuC"
```

#### Output (minimal realm JSON)

```json
{
  "realm": "AppProvider",
  "enabled": true,
  "sslRequired": "none",
  "registrationAllowed": false,
  
  "clients": [
    {
      "clientId": "app-provider-validator",
      "name": "App Provider Validator Service",
      "enabled": true,
      "clientAuthenticatorType": "client-secret",
      "secret": "AL8648b9SfdTFImq7FV56Vd0KHifHBuC",
      "serviceAccountsEnabled": true,
      "standardFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "publicClient": false,
      "protocol": "openid-connect",
      "defaultClientScopes": [
        "web-origins",
        "acr",
        "roles",
        "profile",
        "basic",
        "email",
        "audience_canton_network"
      ]
    }
  ],
  
  "clientScopes": [
    {
      "name": "audience_canton_network",
      "protocol": "openid-connect",
      "attributes": {
        "include.in.token.scope": "false",
        "display.on.consent.screen": "false"
      },
      "protocolMappers": [
        {
          "name": "canton_network_audience",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-audience-mapper",
          "config": {
            "included.custom.audience": "https://canton.network.global",
            "access.token.claim": "true"
          }
        }
      ]
    }
  ]
}
```

**Key Differences from Export:**
- No UUIDs (Keycloak generates them on import)
- No default roles (Keycloak creates them)
- No built-in clients (account, admin-cli, etc.)
- ~50 lines instead of 2,300 lines

#### Generation Algorithm

```typescript
function generateKeycloakRealm(
  realmName: string,
  clients: ClientConfig[],
  audience: string
): KeycloakRealm {
  return {
    realm: realmName,
    enabled: true,
    sslRequired: "none",
    registrationAllowed: false,
    
    clients: clients
      .filter(c => c.realm === realmName)
      .map(c => generateClient(c)),
      
    clientScopes: [
      generateAudienceScope(audience),
      generateServiceAccountScope(),
    ],
  };
}

function generateClient(config: ClientConfig): KeycloakClient {
  if (config.public) {
    return {
      clientId: config.name,
      enabled: true,
      publicClient: true,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: config.redirect_uris ?? ["*"],
      webOrigins: config.web_origins ?? ["*"],
      protocol: "openid-connect",
      defaultClientScopes: ["web-origins", "acr", "audience_canton_network", "roles", "profile", "basic", "email"],
    };
  }
  
  if (config.service_account) {
    return {
      clientId: config.name,
      enabled: true,
      clientAuthenticatorType: "client-secret",
      secret: config.client_secret,
      serviceAccountsEnabled: true,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      publicClient: false,
      protocol: "openid-connect",
      defaultClientScopes: ["web-origins", "service_account", "acr", "audience_canton_network", "roles", "profile", "basic", "email"],
    };
  }
  
  // Default: confidential client with standard flow
  return {
    clientId: config.name,
    enabled: true,
    clientAuthenticatorType: "client-secret",
    secret: config.client_secret,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    publicClient: false,
    protocol: "openid-connect",
    redirectUris: config.redirect_uris ?? ["*"],
    webOrigins: config.web_origins ?? ["*"],
    defaultClientScopes: ["web-origins", "acr", "audience_canton_network", "roles", "profile", "basic", "email"],
  };
}
```

### Environment File Generation

#### Input (from localnet.yaml)

```yaml
participants:
  app-provider:
    enabled: true
    json_api_port: 3975
    realm: "AppProvider"
    
keycloak:
  url: "http://localhost:8082"
  audience: "https://canton.network.global"
```

#### Output (.localnet/generated/env/localnet.env)

```bash
# Generated by localnet generate
# Source: localnet.yaml
# Generated at: 2026-01-16T20:00:00Z

# Profile Configuration
SV_PROFILE=off
APP_PROVIDER_PROFILE=on
APP_USER_PROFILE=on

# Authentication Mode
AUTH_MODE=oauth2
OBSERVABILITY_ENABLED=false

# Party Hints (namespace will be added at runtime)
PARTY_HINT=localnet

# Keycloak
AUTH_APP_PROVIDER_ISSUER_URL=http://localhost:8082/realms/AppProvider
AUTH_APP_PROVIDER_WELLKNOWN_URL=http://localhost:8082/realms/AppProvider/.well-known/openid-configuration
AUTH_APP_PROVIDER_TOKEN_URL=http://localhost:8082/realms/AppProvider/protocol/openid-connect/token
AUTH_APP_PROVIDER_AUDIENCE=https://canton.network.global

AUTH_APP_USER_ISSUER_URL=http://localhost:8082/realms/AppUser
AUTH_APP_USER_WELLKNOWN_URL=http://localhost:8082/realms/AppUser/.well-known/openid-configuration
AUTH_APP_USER_TOKEN_URL=http://localhost:8082/realms/AppUser/protocol/openid-connect/token
AUTH_APP_USER_AUDIENCE=https://canton.network.global
```

### Docker Compose Override Generation

Only generated if profile overrides are needed:

```yaml
# .localnet/generated/docker-compose.override.yaml
# Generated by localnet generate

services:
  canton:
    profiles:
      - app-provider
      - app-user
      # sv profile omitted (disabled in localnet.yaml)
      
  splice:
    profiles:
      - app-provider
      - app-user
      
  # Disable wallet UIs (not needed for token development)
  wallet-web-ui-app-user:
    profiles:
      - never
      
  wallet-web-ui-app-provider:
    profiles:
      - never
```

---

## 7. Discovery Logic

### Party ID Discovery

Party IDs are discovered by querying the Canton JSON API after startup.

#### Algorithm

```typescript
interface PartyInfo {
  party_id: string;      // Full party ID with namespace
  party_hint: string;    // Hint without namespace
  user_id: string;       // Ledger user ID
  participant: string;   // Participant name
}

async function discoverParty(
  participant: ParticipantConfig,
  authToken: string
): Promise<PartyInfo> {
  const jsonApiUrl = `http://localhost:${participant.json_api_port}`;
  
  // Get all parties from the participant
  const response = await fetch(`${jsonApiUrl}/v2/parties`, {
    headers: { "Authorization": `Bearer ${authToken}` }
  });
  
  const data = await response.json();
  
  // Find party matching our hint
  const partyHint = `${participant.party_hint}_${config.party_hint_suffix}`;
  const party = data.parties.find((p: any) => 
    p.party.startsWith(partyHint)
  );
  
  if (!party) {
    throw new Error(`Party not found for hint: ${partyHint}`);
  }
  
  return {
    party_id: party.party,
    party_hint: partyHint,
    user_id: "ledger-api-user",  // Default user
    participant: participant.name,
  };
}
```

### Package ID Discovery

Package IDs are tracked during upload and verified against the ledger.

#### Upload and Track

```typescript
interface PackageInfo {
  package_id: string;
  name: string;
  version: string;
  uploaded_to: string[];
  uploaded_at: string;
}

async function uploadAndTrackPackage(
  packageConfig: PackageConfig,
  participant: ParticipantConfig,
  authToken: string
): Promise<PackageInfo> {
  const jsonApiUrl = `http://localhost:${participant.json_api_port}`;
  const darPath = packageConfig.dar_path;
  
  // Read DAR file
  const darContent = await Deno.readFile(darPath);
  
  // Upload to participant
  const response = await fetch(`${jsonApiUrl}/v2/dars?vetAllPackages=true`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: darContent,
  });
  
  const result = await response.json();
  
  // Extract package ID from response
  // Response format: { "mainPackageId": "abc123..." }
  return {
    package_id: result.mainPackageId,
    name: packageConfig.name,
    version: extractVersionFromPath(darPath),
    uploaded_to: [participant.name],
    uploaded_at: new Date().toISOString(),
  };
}
```

#### Verify Against Ledger

```typescript
async function verifyPackage(
  packageId: string,
  participant: ParticipantConfig,
  authToken: string
): Promise<boolean> {
  const jsonApiUrl = `http://localhost:${participant.json_api_port}`;
  
  const response = await fetch(`${jsonApiUrl}/v2/packages`, {
    headers: { "Authorization": `Bearer ${authToken}` }
  });
  
  const data = await response.json();
  
  return data.packages.some((p: any) => p.packageId === packageId);
}
```

### OAuth Token Acquisition

```typescript
interface TokenCache {
  token: string;
  expires_at: number;
}

const tokenCache = new Map<string, TokenCache>();

async function getAuthToken(
  realm: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const cacheKey = `${realm}:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  
  // Return cached token if still valid (with 30s buffer)
  if (cached && cached.expires_at > Date.now() + 30000) {
    return cached.token;
  }
  
  const tokenUrl = `http://localhost:8082/realms/${realm}/protocol/openid-connect/token`;
  
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "openid",
    }),
  });
  
  const data = await response.json();
  
  // Cache token
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expires_at: Date.now() + (data.expires_in * 1000),
  });
  
  return data.access_token;
}
```

### Caching Strategy

```typescript
interface DiscoveryCache {
  parties: Map<string, PartyInfo>;
  packages: Map<string, PackageInfo>;
  cached_at: number;
  ttl_ms: number;
}

class DiscoveryService {
  private cache: DiscoveryCache;
  
  constructor(ttlSeconds: number = 300) {
    this.cache = {
      parties: new Map(),
      packages: new Map(),
      cached_at: 0,
      ttl_ms: ttlSeconds * 1000,
    };
  }
  
  private isCacheValid(): boolean {
    return Date.now() - this.cache.cached_at < this.cache.ttl_ms;
  }
  
  async getParties(): Promise<Map<string, PartyInfo>> {
    if (!this.isCacheValid()) {
      await this.refreshCache();
    }
    return this.cache.parties;
  }
  
  async invalidate(): Promise<void> {
    this.cache.cached_at = 0;
  }
  
  private async refreshCache(): Promise<void> {
    // Re-discover all parties and packages
    for (const participant of enabledParticipants) {
      const token = await getAuthToken(...);
      const party = await discoverParty(participant, token);
      this.cache.parties.set(participant.name, party);
    }
    
    // Verify packages are still uploaded
    for (const [name, pkg] of this.cache.packages) {
      const stillValid = await verifyPackage(pkg.package_id, ...);
      if (!stillValid) {
        this.cache.packages.delete(name);
      }
    }
    
    this.cache.cached_at = Date.now();
  }
}
```

---

## 8. Integration with asset-manager

### Option A: CLI-Generated .env File

**Workflow:**

```bash
# 1. Start LocalNet with discovery
localnet start

# 2. Generate .env for asset-manager
localnet env app-provider -o asset-manager/.env

# 3. Start asset-manager (uses generated .env)
cd asset-manager && deno task dev
```

**Pros:**
- Simple, no code changes to asset-manager
- Works with existing configuration loading

**Cons:**
- Manual step required
- .env must be regenerated if LocalNet restarts

### Option B: Query Discovery API at Startup

**Code Changes (asset-manager/src/server/mod.ts):**

```typescript
import { z } from "zod";

const DiscoveryConfigSchema = z.object({
  DISCOVERY_API_URL: z.string().url().optional(),
  PARTICIPANT: z.string().default("app-provider"),
});

async function loadConfigWithDiscovery(): Promise<Config> {
  const discoveryConfig = DiscoveryConfigSchema.parse(Deno.env.toObject());
  
  // If discovery URL is set, fetch config from discovery API
  if (discoveryConfig.DISCOVERY_API_URL) {
    const envUrl = `${discoveryConfig.DISCOVERY_API_URL}/discovery/env/${discoveryConfig.PARTICIPANT}?format=json`;
    const response = await fetch(envUrl);
    const discovered = await response.json();
    
    // Merge discovered config with any explicit env vars
    return {
      server: loadServerConfig(),
      ledger: {
        API_URL: discovered.ledger.api_url,
        REQUEST_TIMEOUT_MS: 30000,
      },
      registry: {
        PARTY: discovered.registry.party,
      },
      auth: {
        OIDC_CONF_URL: discovered.auth.oidc_conf_url,
        CLIENT_ID: discovered.auth.client_id,
        CLIENT_SECRET: discovered.auth.client_secret,
        AUDIENCE: discovered.auth.audience,
        ALLOW_INSECURE: true,
      },
    };
  }
  
  // Fall back to standard env-based config
  return loadConfig();
}
```

**Usage:**

```bash
# Start with discovery
DISCOVERY_API_URL=http://localhost:3100 deno task dev

# Or in .env
echo "DISCOVERY_API_URL=http://localhost:3100" >> .env
```

**Pros:**
- Automatic configuration
- Always up-to-date with LocalNet state

**Cons:**
- Requires code changes
- Adds runtime dependency on discovery service

### Option C: Conflib with Discovery-Aware Loader

**Create discovery-aware conflib extension:**

```typescript
// tools/localnet-config/src/conflib-discovery.ts
import { z } from "zod";
import { fromEnv, type InferConfigType } from "@denex/conflib";

export interface DiscoveryOptions {
  discoveryUrl?: string;
  participant?: string;
  fallbackToEnv?: boolean;
}

export async function fromEnvWithDiscovery<
  Schema extends z.ZodTypeAny,
  Prefix extends string = "",
>(
  schema: Schema,
  prefix?: Prefix,
  options?: DiscoveryOptions
): Promise<InferConfigType<Schema, Prefix>> {
  const discoveryUrl = options?.discoveryUrl ?? Deno.env.get("DISCOVERY_API_URL");
  
  if (discoveryUrl) {
    try {
      const participant = options?.participant ?? "app-provider";
      const response = await fetch(
        `${discoveryUrl}/discovery/env/${participant}?format=json`
      );
      const discovered = await response.json();
      
      // Convert discovered config to env-like object
      const envLike = flattenToEnv(discovered, prefix);
      
      // Parse with schema
      return fromObj(envLike, schema, prefix);
    } catch (error) {
      if (options?.fallbackToEnv) {
        console.warn("Discovery failed, falling back to environment:", error);
      } else {
        throw error;
      }
    }
  }
  
  // Standard env loading
  return fromEnv(schema, prefix);
}
```

**Usage in asset-manager:**

```typescript
import { fromEnvWithDiscovery } from "@localnet/conflib-discovery";
import { ServerConfig, LedgerConfig, AuthConfig, RegistryConfig } from "./shared/config.ts";

const config = await fromEnvWithDiscovery({
  server: ["SERVER_", ServerConfig],
  ledger: ["LEDGER_", LedgerConfig],
  auth: ["AUTH_", AuthConfig],
  registry: ["REGISTRY_", RegistryConfig],
}, {
  discoveryUrl: Deno.env.get("DISCOVERY_API_URL"),
  participant: "app-provider",
  fallbackToEnv: true,
});
```

**Pros:**
- Clean integration with existing conflib patterns
- Automatic fallback to environment

**Cons:**
- Requires building conflib extension
- More complex implementation

### Recommendation

**For mg-tokenization, recommend Option A (CLI-generated .env) for short-term:**

1. Zero code changes to asset-manager
2. Explicit, debuggable configuration
3. Easy to understand and troubleshoot

**Migrate to Option C (conflib with discovery) when:**
- Multiple developers need consistent setup
- CI/CD integration requires dynamic configuration
- conflib is already being adopted project-wide

---

## 9. Implementation Approach

### Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript/Deno | Consistent with asset-manager |
| CLI Framework | [Cliffy](https://cliffy.io/) | Full-featured, Deno-native CLI framework |
| HTTP Server | [Hono](https://hono.dev/) | Fast, lightweight, Deno-compatible |
| Validation | Zod | Already used in project, excellent DX |
| YAML Parsing | `@std/yaml` | Deno standard library |
| Testing | `@std/testing` | Deno standard library |

### Project Structure

```
tools/localnet-config/
├── deno.json              # Deno configuration
├── deno.lock              # Lock file
├── mod.ts                 # Main entry point
├── src/
│   ├── cli/
│   │   ├── mod.ts         # CLI entry point
│   │   ├── commands/
│   │   │   ├── generate.ts
│   │   │   ├── start.ts
│   │   │   ├── stop.ts
│   │   │   ├── status.ts
│   │   │   ├── parties.ts
│   │   │   ├── packages.ts
│   │   │   ├── env.ts
│   │   │   └── serve.ts
│   │   └── utils/
│   │       ├── config.ts      # Config loading
│   │       ├── output.ts      # Formatting
│   │       └── quickstart.ts  # cn-quickstart wrapper
│   ├── generator/
│   │   ├── mod.ts
│   │   ├── keycloak.ts        # Realm JSON generation
│   │   ├── env.ts             # .env generation
│   │   └── compose.ts         # docker-compose.override
│   ├── discovery/
│   │   ├── mod.ts
│   │   ├── server.ts          # Hono HTTP server
│   │   ├── parties.ts         # Party discovery
│   │   ├── packages.ts        # Package tracking
│   │   └── cache.ts           # Caching logic
│   ├── schemas/
│   │   ├── config.ts          # localnet.yaml schema
│   │   ├── keycloak.ts        # Keycloak realm schema
│   │   └── api.ts             # API response schemas
│   └── types.ts               # Shared types
├── test/
│   ├── generator/
│   │   └── keycloak.test.ts
│   ├── discovery/
│   │   └── parties.test.ts
│   └── fixtures/
│       └── localnet.yaml
└── README.md
```

### Dependencies

```json
// deno.json
{
  "name": "@mg-token/localnet-config",
  "version": "0.1.0",
  "exports": "./mod.ts",
  "tasks": {
    "cli": "deno run --allow-read --allow-write --allow-env --allow-net --allow-run src/cli/mod.ts",
    "serve": "deno run --allow-read --allow-write --allow-env --allow-net src/discovery/server.ts",
    "test": "deno test --allow-read --allow-env",
    "check": "deno check mod.ts"
  },
  "imports": {
    "@cliffy/command": "jsr:@cliffy/command@^1.0.0",
    "@cliffy/table": "jsr:@cliffy/table@^1.0.0",
    "@std/yaml": "jsr:@std/yaml@^1.0.0",
    "@std/path": "jsr:@std/path@^1.0.0",
    "@std/fs": "jsr:@std/fs@^1.0.0",
    "hono": "jsr:@hono/hono@^4.0.0",
    "zod": "npm:zod@^3.23.0"
  }
}
```

### Effort Estimate

| Phase | Tasks | Effort |
|-------|-------|--------|
| **Phase 1: Core** | Schema, config loading, basic CLI | 4 hours |
| **Phase 2: Generator** | Keycloak realm, .env generation | 4 hours |
| **Phase 3: Discovery** | HTTP server, party/package discovery | 4 hours |
| **Phase 4: CLI** | All commands, formatting, help | 4 hours |
| **Phase 5: Integration** | Testing, documentation | 2 hours |
| **Total** | | **~2 days** |

### Installation

```bash
# From project root
deno install --allow-all --name localnet tools/localnet-config/src/cli/mod.ts

# Or run directly
deno task --cwd tools/localnet-config cli <command>
```

---

## 10. Usage Examples

### Complete Workflow: New Developer Setup

```bash
# 1. Clone project and install dependencies
git clone https://github.com/mg/mg-tokenization.git
cd mg-tokenization
git submodule update --init  # Get cn-quickstart

# 2. Create localnet.yaml (or use default)
cat > localnet.yaml << 'EOF'
version: "1.0"

participants:
  app-provider:
    enabled: true
    
clients:
  app-provider-validator:
    realm: "AppProvider"
    service_account: true

packages:
  - name: "token-manager-v1"
    dar_path: "daml/token-manager-v1/.daml/dist/token-manager-v1-1.0.0.dar"
    upload_to: ["app-provider"]
EOF

# 3. Build DAML
cd daml/token-manager-v1 && dpm build && cd ../..

# 4. Start LocalNet (generates configs, starts services, uploads packages)
localnet start

# 5. Check status
localnet status

# 6. Generate .env for asset-manager
localnet env app-provider -o asset-manager/.env

# 7. Start asset-manager
cd asset-manager && deno task dev
```

### Workflow: After DAML Changes

```bash
# 1. Rebuild DAML
cd daml/token-manager-v1 && dpm build && cd ../..

# 2. Upload new package (LocalNet already running)
localnet packages upload token-manager-v1

# 3. Regenerate .env with new package ID
localnet env app-provider -o asset-manager/.env

# 4. Restart asset-manager (or it hot-reloads)
```

### Workflow: CI/CD Integration

```bash
#!/bin/bash
# ci/integration-test.sh

set -e

# Start LocalNet
localnet start --timeout 600

# Wait for healthy status
localnet status --format json | jq -e '.healthy == true'

# Run E2E tests with discovered config
export DISCOVERY_API_URL=http://localhost:3100
cd asset-manager && deno task test:e2e

# Cleanup
localnet stop --clean
```

### Workflow: Adding New OAuth Client

```yaml
# localnet.yaml - add new client
clients:
  app-provider-validator:
    # ... existing
    
  my-new-service:           # <-- Add this
    realm: "AppProvider"
    service_account: true
    client_secret: "my-secret-123"
```

```bash
# Regenerate and apply
localnet generate --keycloak
localnet stop
localnet start --no-generate  # Use just-generated configs
```

### Workflow: Programmatic Discovery (TypeScript)

```typescript
// Integration test setup
import { assertEquals } from "@std/assert";

const DISCOVERY_URL = "http://localhost:3100";

Deno.test("discover party IDs", async () => {
  const response = await fetch(`${DISCOVERY_URL}/discovery/parties/app-provider`);
  const party = await response.json();
  
  // Party ID follows expected pattern
  assertEquals(party.party_hint.startsWith("app_provider"), true);
  assertEquals(party.party_id.includes("::"), true);
  
  // Use in test
  const ledgerClient = createLedgerClient({
    apiUrl: "http://localhost:3975",
    adminParty: party.party_id,
  });
  
  // ... run tests
});
```

### Workflow: Shell Script Discovery

```bash
#!/bin/bash
# scripts/run-with-discovery.sh

# Get config from discovery API
CONFIG=$(curl -s http://localhost:3100/discovery/env/app-provider?format=shell)

# Export as environment variables
eval "$CONFIG"

# Run command with discovered config
exec "$@"
```

```bash
# Usage
./scripts/run-with-discovery.sh deno task dev
```

---

## Appendix: References

### Related Documents

- [LocalNet Simplification Research](./localnet-simplification-research.md) - Comprehensive analysis of current setup
- [Canton Quickstart README](../../cn-quickstart/README.md) - Official cn-quickstart documentation
- [asset-manager Configuration](../../asset-manager/src/shared/config.ts) - Current config schema

### External Resources

- [Canton JSON API v2](https://docs.digitalasset.com/build/3.4/reference/canton-json-api/index.html)
- [Keycloak Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/index.html)
- [keycloak-config-cli](https://github.com/adorsys/keycloak-config-cli) - Configuration as code tool
- [Cliffy CLI Framework](https://cliffy.io/) - Deno CLI framework
- [Hono](https://hono.dev/) - Fast HTTP framework

### API Compatibility

This specification targets:
- Canton JSON API v2 (cn-quickstart 0.4.9+)
- Keycloak 24.x (as bundled with cn-quickstart)
- Deno 2.0+

---

*Specification authored: January 2026*
