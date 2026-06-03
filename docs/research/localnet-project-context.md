# LocalNet Tooling Project Context

> [!WARNING]
> Historical context from predecessor research. It contains useful Canton background, but project
> structure, ports, and implementation details may not match `denex-localnet`.

> Additional context from mg-tokenization research and conversations for agents working on the
> localnet-tools project.

**Date:** January 2026\
**Source:** mg-tokenization project

---

## 1. Project Constraints (from conversations)

These constraints were established through discussion and should not be revisited:

| Constraint                                | Rationale                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| **Full Splice/Canton stack required**     | Can't simplify to Canton-only; Token Standard interfaces require Splice validators |
| **OAuth2 with Keycloak required**         | Shared-secret mode not acceptable for production parity testing                    |
| **Resource usage (8GB+) is acceptable**   | This is not a problem to solve; focus on configuration UX instead                  |
| **Must work with existing cn-quickstart** | Wrap and extend, don't replace the existing infrastructure                         |
| **Don't modify submodules**               | Generate configs that cn-quickstart consumes, don't fork                           |

---

## 2. What NOT to Pursue (Dead Ends)

These approaches were researched and rejected:

| Approach                         | Why It Doesn't Work                                                  |
| -------------------------------- | -------------------------------------------------------------------- |
| **DAML Sandbox**                 | Single participant only, no Splice, no Token Standard interfaces     |
| **Canton Console standalone**    | Missing Splice validators and Token Standard DAR dependencies        |
| **Shared-secret auth**           | Needed for OAuth2 flow testing in real applications                  |
| **Reducing container count**     | The infrastructure genuinely needs all components for Token Standard |
| **Simplifying to 1 participant** | Some workflows (transfers, allocations) require 2+ participants      |
| **In-memory databases**          | State loss unacceptable for iterative development                    |

---

## 3. Key Technical Reference

### Port Scheme

```
Participant    Prefix   JSON API   Ledger API   Admin API   Validator API
-----------    ------   --------   ----------   ---------   -------------
App User       2xxx     2975       2901         2902        2903
App Provider   3xxx     3975       3901         3902        3903
SV             4xxx     4975       4901         4902        4903
```

**Port Suffixes:**

- `901` - Ledger API (gRPC)
- `902` - Admin API (gRPC)
- `903` - Validator Admin API (HTTP)
- `975` - JSON API (HTTP)
- `900` - HTTP Health Check
- `961` - gRPC Health Check

### OAuth2 Credentials (pre-configured in cn-quickstart)

```yaml
# AppUser Realm
realm: AppUser
token_url: http://localhost:8082/realms/AppUser/protocol/openid-connect/token
jwks_url: http://localhost:8082/realms/AppUser/protocol/openid-connect/certs
clients:
  app-user-validator:
    secret: 6m12QyyGl81d9nABWQXMycZdXho6ejEX
    type: confidential (service account)
  app-user-wallet:
    type: public
  app-user-pqs:
    type: confidential

# AppProvider Realm
realm: AppProvider
token_url: http://localhost:8082/realms/AppProvider/protocol/openid-connect/token
jwks_url: http://localhost:8082/realms/AppProvider/protocol/openid-connect/certs
clients:
  app-provider-validator:
    secret: AL8648b9SfdTFImq7FV56Vd0KHifHBuC
    type: confidential (service account)
  app-provider-backend:
    secret: 05dmL9DAUmDnIlfoZ5EQ7pKskWmhBlNz
    type: confidential
  app-provider-wallet:
    type: public

# Common
audience: https://canton.network.global
```

### Party ID Format

```
{party_hint}::{namespace}

Examples:
  app_provider_quickstart-mgaare-1::1220e46903d02f76f0911c27dc2d29d4211b3fae7a2300db223f4074c5b59bdedc1b
  app_user_quickstart-mgaare-1::1220f57123...

Notes:
  - Namespace is generated at participant startup
  - Changes on clean restart (make clean-all)
  - Party hint prefix (app_provider, app_user) is configurable
  - Full party ID must be discovered at runtime via API
```

### JSON API v2 Endpoints for Party/User Management

```bash
# Health check
GET  /v2/version

# Get participant namespace
GET  /v2/parties/participant-id
# Response: { "participantId": "participant::1220..." }

# List all parties
GET  /v2/parties

# Get specific party by hint
GET  /v2/parties/party?parties={hint}::{namespace}

# Allocate new party
POST /v2/parties
{
  "partyIdHint": "my-party",
  "displayName": "My Party",
  "identityProviderId": ""
}

# Get user details (includes primaryParty)
GET  /v2/users/{userId}
# Response: { "user": { "id": "...", "primaryParty": "..." } }

# Create user
POST /v2/users
{
  "user": {
    "id": "my-user",
    "primaryParty": "party::namespace",
    "isDeactivated": false,
    "metadata": { "annotations": { "username": "My User" } }
  },
  "rights": []
}

# Grant rights to user
POST /v2/users/{userId}/rights
{
  "userId": "my-user",
  "rights": [
    { "kind": { "ParticipantAdmin": { "value": {} } } },
    { "kind": { "CanActAs": { "value": { "party": "..." } } } },
    { "kind": { "CanReadAs": { "value": { "party": "..." } } } }
  ]
}

# Upload DAR package
POST /v2/packages
POST /v2/dars?vetAllPackages=true
Content-Type: application/octet-stream
Body: <binary DAR content>
# Response: { "mainPackageId": "abc123..." }

# List packages
GET  /v2/packages
```

---

## 4. Patterns from mg-tokenization That Worked Well

### QuickstartClient Helper

From `asset-manager/src/test/e2e/quickstart.ts`:

```typescript
export class QuickstartClient {
  private readonly config: QuickstartConfig;
  private tokenCache: Map<string, { token: string; expiry: number }> = new Map();

  // Health check with timeout
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.appUserJsonApi}/v2/version`, {
        signal: AbortSignal.timeout(5000),
      });
      await response.text(); // MUST consume body (Deno leak detection)
      return response.ok;
    } catch {
      return false;
    }
  }

  // OAuth token with caching
  private async fetchAccessToken(credentials: RealmCredentials): Promise<string> {
    const cacheKey = credentials.realm;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry - 30000) { // 30s refresh buffer
      return cached.token;
    }

    const tokenUrl =
      `${this.config.keycloakUrl}/realms/${credentials.realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });

    const json = await response.json();
    const expiry = Date.now() + (json.expires_in * 1000);
    this.tokenCache.set(cacheKey, { token: json.access_token, expiry });
    return json.access_token;
  }

  // Party discovery
  async getAppProviderParty(): Promise<PartyInfo> {
    const parties = await this.getParties(this.config.appProviderJsonApi, APP_PROVIDER_CREDENTIALS);
    const localParty = parties.find((p) => p.party?.startsWith('app_provider'));
    if (!localParty) {
      throw new Error('No app_provider party found');
    }
    return { ...localParty, partyId: localParty.party };
  }
}
```

**Key Patterns:**

- Token caching with Map and expiry timestamps
- 30-second refresh buffer before token expiry
- AbortSignal.timeout for all network calls
- Party discovery by prefix matching
- Always consume response bodies

### upload-dar.sh OAuth Pattern

From `scripts/upload-dar.sh`:

```bash
get_token() {
    local realm="$1"
    local client_id="$2"
    local client_secret="$3"
    local token_url="http://localhost:8082/realms/${realm}/protocol/openid-connect/token"
    
    curl -f -s -S "$token_url" \
        -H 'Content-Type: application/x-www-form-urlencoded' \
        -d "client_id=${client_id}" \
        -d "client_secret=${client_secret}" \
        -d 'grant_type=client_credentials' \
        -d 'scope=openid' | jq -r .access_token
}

# Smart realm detection based on port
determine_auth() {
    case "$PARTICIPANT_URL" in
        *:2975*)
            echo "AppUser $APP_USER_CLIENT_ID $APP_USER_CLIENT_SECRET"
            ;;
        *:3975*|*:4975*|*)
            echo "AppProvider $APP_PROVIDER_CLIENT_ID $APP_PROVIDER_CLIENT_SECRET"
            ;;
    esac
}
```

**Key Patterns:**

- Auto-detect realm from port number
- Use curl with `-f -s -S` flags for proper error handling
- Parse JSON with jq
- Only use hardcoded secrets for localhost URLs

### conflib Configuration Pattern

From `app-platform-mvp/conflib/`:

```typescript
import { z } from 'zod';
import { fromEnvMap } from '@denex/conflib';

// Define schemas for each component
const ServerConfig = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
});

const LedgerConfig = z.object({
  API_URL: z.string().url(),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
});

const AuthConfig = z.union([
  z.object({ // OAuth
    OIDC_CONF_URL: z.string().url(),
    CLIENT_ID: z.string(),
    CLIENT_SECRET: z.string(),
    AUDIENCE: z.string(),
    ALLOW_INSECURE: z.coerce.boolean().default(false),
  }),
  z.object({ // Bearer token
    BEARER_TOKEN: z.string(),
  }),
]);

// Load with prefixes
const config = fromEnvMap({
  server: ['SERVER_', ServerConfig],
  ledger: ['LEDGER_', LedgerConfig],
  auth: ['AUTH_', AuthConfig],
});

// Result type inferred:
// { server: { port: number, host: string }, ledger: {...}, auth: {...} }
```

**Key Patterns:**

- Group env vars by prefix (SERVER_, LEDGER_, AUTH_)
- Use z.union for alternative configs (OAuth vs Bearer)
- Automatic UPPER_SNAKE_CASE to camelCase conversion
- Type inference from schemas

---

## 5. Key Files in cn-quickstart to Understand

| Path                                                          | What It Does                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| `quickstart/docker/modules/localnet/compose.yaml`             | Core services: canton, splice, postgres, nginx, wallet UIs |
| `quickstart/docker/modules/keycloak/compose.yaml`             | OAuth2 Keycloak + nginx-keycloak proxy                     |
| `quickstart/docker/modules/splice-onboarding/compose.yaml`    | Init container that runs setup scripts                     |
| `quickstart/docker/modules/splice-onboarding/docker/utils.sh` | Shell functions for party/user management                  |
| `quickstart/docker/modules/keycloak/conf/data/*.json`         | Keycloak realm exports (2,300+ lines each)                 |
| `quickstart/Makefile`                                         | Build/start/stop commands                                  |
| `quickstart/.env`                                             | Project-level defaults                                     |
| `quickstart/.env.local`                                       | User overrides (from make setup)                           |
| `quickstart/docker/modules/localnet/env/common.env`           | Port suffixes, DB config, Splice settings                  |

### Makefile Key Targets

```bash
make setup          # Interactive config (LocalNet, OAuth2, observability)
make build          # Build all components
make start          # Start LocalNet
make stop           # Stop LocalNet
make clean-docker   # Stop and remove containers/volumes
make clean-all      # Full cleanup
make canton-console # Launch Canton console
make shell          # Launch DAML Shell
make status         # Show container status
make compose-config # Show resolved Docker Compose config
```

### splice-onboarding utils.sh Key Functions

```bash
# OAuth token retrieval
get_admin_token(secret, clientId, tokenUrl)
get_user_token(user, password, clientId, tokenUrl)

# Party management
allocate_party(token, partyIdHint, participant)
get_participant_namespace(token, participant)
get_user_party(token, user, participant)

# User management
create_user(token, userId, userName, party, participant)
update_user(token, userId, userName, party, participant)
delete_user(token, userId, participant)
grant_rights(token, userId, partyId, rights, participant)

# DAR upload
upload_dars(token, participant)  # Uploads all from /canton/dars

# Config sharing
share_file(relative_path)  # Writes to /onboarding volume
```

---

## 6. Key Files in Splice Repo

Based on research, these paths are likely relevant (needs verification in actual splice repo):

| Path                                    | What It Provides                                        |
| --------------------------------------- | ------------------------------------------------------- |
| `cluster/compose/localnet/`             | Base LocalNet infrastructure that cn-quickstart extends |
| `cluster/compose/localnet/compose.yaml` | Core Canton/Splice compose                              |
| `cluster/compose/localnet/env/`         | Environment file templates                              |

**Note:** cn-quickstart copies/extends the splice localnet compose files. The localnet-tools project
should reference cn-quickstart, not splice directly.

---

## 7. Implementation Recommendations

### Technology Stack

Consistent with modern Deno projects in mg-tokenization:

| Component     | Choice                       | Rationale                          |
| ------------- | ---------------------------- | ---------------------------------- |
| Runtime       | Deno 2.x                     | Consistent with asset-manager      |
| Language      | TypeScript                   | Type safety, IDE support           |
| CLI Framework | [Cliffy](https://cliffy.io/) | Full-featured, Deno-native         |
| HTTP Server   | [Hono](https://hono.dev/)    | Fast, lightweight, Deno-compatible |
| Validation    | Zod                          | Already used extensively           |
| YAML Parsing  | `@std/yaml`                  | Deno standard library              |
| Testing       | `@std/testing`               | Deno standard library              |

### Recommended Project Structure

```
localnet-tools/
├── splice/              # Submodule: hyperledger-labs/splice
├── quickstart/          # Submodule: digital-asset/cn-quickstart
├── docs/
│   └── research/        # This research (copied from mg-tokenization)
│       ├── localnet-tooling-specification.md
│       ├── localnet-simplification-research.md
│       └── localnet-project-context.md
├── src/
│   ├── cli/            # CLI commands (Cliffy)
│   │   ├── mod.ts      # Entry point
│   │   └── commands/   # Individual commands
│   ├── generator/      # Config generation
│   │   ├── keycloak.ts # Realm JSON generation
│   │   └── env.ts      # .env file generation
│   ├── discovery/      # Runtime discovery
│   │   ├── server.ts   # Hono HTTP server
│   │   ├── parties.ts  # Party ID discovery
│   │   └── packages.ts # Package ID tracking
│   ├── schemas/        # Zod schemas
│   │   ├── config.ts   # localnet.yaml schema
│   │   └── api.ts      # API response schemas
│   └── utils/          # Shared utilities
│       └── oauth.ts    # Token caching
├── test/               # Tests
├── localnet.yaml       # Example configuration
├── deno.json
└── AGENTS.md
```

### Key Design Decisions

1. **Config File**: Single `localnet.yaml` (~50 lines) replaces 37+ env files

2. **Keycloak Generation**: Generate minimal realm JSON (50 lines) instead of editing 2,300-line
   exports

3. **Discovery API**: HTTP server at port 3100 for runtime discovery

4. **Caching Strategy**: 5-minute TTL for party/package IDs (stable after startup)

5. **Environment Output**: Generate both dotenv and JSON formats for different consumers

6. **Integration Pattern**: Generate configs to `.localnet/generated/`, then start cn-quickstart
   with those configs

---

## 8. Reference: Complete OAuth Flow

```
┌─────────────┐      ┌───────────────┐      ┌─────────────┐
│  localnet   │      │   Keycloak    │      │  JSON API   │
│   tools     │      │  :8082        │      │  :3975      │
└──────┬──────┘      └───────┬───────┘      └──────┬──────┘
       │                     │                     │
       │ POST /token         │                     │
       │ grant_type=client_  │                     │
       │ credentials         │                     │
       │────────────────────>│                     │
       │                     │                     │
       │ { access_token,     │                     │
       │   expires_in: 300 } │                     │
       │<────────────────────│                     │
       │                     │                     │
       │ GET /v2/parties                          │
       │ Authorization: Bearer {token}             │
       │──────────────────────────────────────────>│
       │                                           │
       │ { partyDetails: [...] }                   │
       │<──────────────────────────────────────────│
       │                     │                     │
```

**Token Endpoints:**

```
AppUser:     http://localhost:8082/realms/AppUser/protocol/openid-connect/token
AppProvider: http://localhost:8082/realms/AppProvider/protocol/openid-connect/token
```

**Token Request:**

```bash
curl -X POST "${TOKEN_URL}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "scope=openid"
```

**Token Response:**

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 300,
  "token_type": "Bearer",
  "scope": "openid"
}
```

---

_Document compiled from mg-tokenization codebase analysis, cn-quickstart exploration, and project
discussions. January 2026._
