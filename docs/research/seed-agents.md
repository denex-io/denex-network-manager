# Agent Guidelines for localnet-tools

LocalNet management tooling for Canton Network development.

## Project Purpose

This project provides simplified configuration and runtime discovery for Canton Network LocalNet, wrapping cn-quickstart with:

1. A human-readable `localnet.yaml` config file (~50 lines vs 135+ config files)
2. Automatic generation of low-level configs (Keycloak realms, .env files)
3. Runtime discovery API for party IDs, package IDs, connection info
4. CLI commands for common operations

## Project Structure

```
localnet-tools/
├── splice/              # Git submodule: hyperledger-labs/splice
├── quickstart/          # Git submodule: digital-asset/cn-quickstart
├── docs/
│   └── research/        # Research and specifications from mg-tokenization
│       ├── localnet-tooling-specification.md  # Complete specification
│       ├── localnet-simplification-research.md # Analysis of cn-quickstart
│       └── localnet-project-context.md        # Technical reference
├── src/
│   ├── cli/             # CLI commands (Cliffy)
│   │   ├── mod.ts       # Entry point
│   │   └── commands/    # Individual command implementations
│   │       ├── generate.ts
│   │       ├── start.ts
│   │       ├── stop.ts
│   │       ├── status.ts
│   │       ├── parties.ts
│   │       ├── packages.ts
│   │       ├── env.ts
│   │       └── serve.ts
│   ├── generator/       # Config generation logic
│   │   ├── keycloak.ts  # Keycloak realm JSON generation
│   │   ├── env.ts       # .env file generation
│   │   └── compose.ts   # docker-compose.override generation
│   ├── discovery/       # Runtime discovery
│   │   ├── server.ts    # Hono HTTP server
│   │   ├── parties.ts   # Party ID discovery
│   │   ├── packages.ts  # Package ID tracking
│   │   └── cache.ts     # Caching logic
│   ├── schemas/         # Zod schemas for config and API
│   │   ├── config.ts    # localnet.yaml schema
│   │   ├── keycloak.ts  # Keycloak realm schema
│   │   └── api.ts       # API response schemas
│   └── utils/           # Shared utilities
│       ├── oauth.ts     # Token caching
│       └── fetch.ts     # HTTP helpers
├── test/                # Tests
│   ├── generator/
│   ├── discovery/
│   └── fixtures/
├── .localnet/           # Generated output directory (gitignored)
│   ├── generated/       # Generated configs
│   └── state/           # Runtime state (parties.json, packages.json)
├── localnet.yaml        # Example/default configuration
├── deno.json            # Deno configuration
└── AGENTS.md            # This file
```

## Key Resources

### Research Documents (docs/research/)

**READ THESE FIRST before implementing:**

| Document | Purpose |
|----------|---------|
| `localnet-tooling-specification.md` | Complete specification with schemas, CLI design, API design |
| `localnet-simplification-research.md` | Deep analysis of cn-quickstart complexity |
| `localnet-project-context.md` | Technical reference, constraints, patterns that work |

### Submodules

- `quickstart/` - Canton Network Quickstart (extends Splice LocalNet)
- `splice/` - Hyperledger Splice (includes base LocalNet)

**Important:** Don't modify submodules. Generate configs that they consume.

## Development Workflow

### Prerequisites

- Deno 2.x
- Docker and Docker Compose
- ~10GB RAM available for LocalNet

### Commands

```bash
# Install CLI globally
deno install --allow-all --name localnet src/cli/mod.ts

# Or run directly
deno task cli <command>

# Run tests
deno task test

# Type check
deno task check

# Format
deno task fmt
```

### Deno Tasks (deno.json)

```json
{
  "tasks": {
    "cli": "deno run --allow-all src/cli/mod.ts",
    "serve": "deno run --allow-all src/discovery/server.ts",
    "test": "deno test --allow-read --allow-env",
    "check": "deno check src/**/*.ts",
    "fmt": "deno fmt"
  }
}
```

## Key Constraints

**DO NOT revisit these decisions:**

1. **Full Splice required** - Cannot simplify to Canton-only (Token Standard needs Splice)
2. **OAuth2 required** - Keycloak integration must work (production parity)
3. **Don't modify submodules** - Wrap/extend, never fork
4. **Resource usage is fine** - Focus on configuration UX, not optimization
5. **8GB+ memory is acceptable** - Not a problem to solve

## Technical Reference

### LocalNet Port Scheme

| Participant | JSON API | Ledger API | Admin API | Validator API |
|-------------|----------|------------|-----------|---------------|
| App User | 2975 | 2901 | 2902 | 2903 |
| App Provider | 3975 | 3901 | 3902 | 3903 |
| SV | 4975 | 4901 | 4902 | 4903 |

**Port Suffix Convention:**
- `901` = Ledger API (gRPC)
- `902` = Admin API (gRPC)
- `903` = Validator Admin API (HTTP)
- `975` = JSON API (HTTP)

### OAuth2 Endpoints

```
Token URL:  http://localhost:8082/realms/{realm}/protocol/openid-connect/token
JWKS URL:   http://localhost:8082/realms/{realm}/protocol/openid-connect/certs
Audience:   https://canton.network.global
```

### Pre-configured Credentials (localhost only)

| Realm | Client | Secret |
|-------|--------|--------|
| AppUser | app-user-validator | 6m12QyyGl81d9nABWQXMycZdXho6ejEX |
| AppProvider | app-provider-validator | AL8648b9SfdTFImq7FV56Vd0KHifHBuC |
| AppProvider | app-provider-backend | 05dmL9DAUmDnIlfoZ5EQ7pKskWmhBlNz |

### Party ID Format

```
{party_hint}::{namespace}

Example: app_provider_quickstart-mgaare-1::1220e46903d02f76f0911c27dc2d29d4211b3fae7a2300db223f4074c5b59bdedc1b
```

- Namespace generated at participant startup
- Changes on `make clean-all`
- Must be discovered at runtime via `/v2/parties` API

## Implementation Priorities

### Phase 1: Core CLI

- [ ] Config loading (`localnet.yaml` Zod schema)
- [ ] Status command (health check all services)
- [ ] Parties command (discover party IDs)
- [ ] Packages command (list uploaded packages)

### Phase 2: Discovery API

- [ ] Hono HTTP server on port 3100
- [ ] `/discovery/status` - Service health
- [ ] `/discovery/parties` - Party IDs
- [ ] `/discovery/packages` - Package IDs
- [ ] `/discovery/env/:participant` - Generated env config
- [ ] Party/package caching with TTL

### Phase 3: Config Generation

- [ ] Keycloak realm JSON generation (minimal, not 2300-line exports)
- [ ] .env file generation for cn-quickstart
- [ ] docker-compose.override.yaml generation

### Phase 4: Full Integration

- [ ] `localnet start` (wraps cn-quickstart `make start`)
- [ ] `localnet stop` (wraps cn-quickstart `make stop`)
- [ ] `localnet generate` (all config generation)
- [ ] Package upload command

## Code Patterns

### Zod Schema Validation

**ALWAYS use Zod for external data validation:**

```typescript
import { z } from "zod";

const PartyResponseSchema = z.object({
  partyDetails: z.array(z.object({
    party: z.string(),
    isLocal: z.boolean(),
  })),
});

const response = await fetch(`${jsonApiUrl}/v2/parties`, { headers });
const json = await response.json();
const data = PartyResponseSchema.parse(json);  // Runtime validation
```

### OAuth Token Caching

**Cache tokens with expiry buffer:**

```typescript
interface TokenCache {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCache>();

async function getToken(realm: string, clientId: string, clientSecret: string): Promise<string> {
  const key = `${realm}:${clientId}`;
  const cached = tokenCache.get(key);
  
  // 30-second buffer before expiry
  if (cached && cached.expiresAt > Date.now() + 30000) {
    return cached.token;
  }
  
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  
  const json = await response.json();
  tokenCache.set(key, {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in * 1000),
  });
  
  return json.access_token;
}
```

### HTTP with Timeout

**Always use AbortSignal.timeout:**

```typescript
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(10000),  // 10 second timeout
});

// MUST consume body (Deno resource leak detection)
await response.text();
```

### Error Handling

**Use typed errors with context:**

```typescript
class LocalNetError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "LocalNetError";
  }
}

// Usage
throw new LocalNetError(
  `Failed to discover party for ${participant}`,
  "PARTY_DISCOVERY_FAILED",
  originalError
);
```

## Testing

### Unit Tests

Test generation logic in isolation with fixture files:

```typescript
import { assertEquals } from "@std/assert";

Deno.test("generateKeycloakRealm creates minimal realm", () => {
  const realm = generateKeycloakRealm("AppProvider", [
    { name: "my-client", service_account: true, secret: "test-secret" }
  ]);
  
  assertEquals(realm.realm, "AppProvider");
  assertEquals(realm.clients.length, 1);
  assertEquals(realm.clients[0].clientId, "my-client");
});
```

### Integration Tests

Use actual LocalNet for discovery tests (requires running services):

```typescript
Deno.test({
  name: "discover parties from running LocalNet",
  ignore: Deno.env.get("LOCALNET_RUNNING") !== "true",
  async fn() {
    const parties = await discoverParties("http://localhost:3975");
    assert(parties["app-provider"]?.party_id.includes("app_provider"));
  },
});
```

## Common Pitfalls

1. **Keycloak realm JSON is not hand-editable** - Use generation, never manual edits
2. **Party IDs include namespace** - Format is `{hint}::{namespace}`, not just hint
3. **Package IDs change on rebuild** - Always query, never hardcode
4. **Multiple Keycloak URLs** - Internal (`nginx-keycloak:8082`) vs external (`localhost:8082`)
5. **Deno resource leaks** - Always consume response bodies with `await response.text()`
6. **Token expiry buffer** - Check `expiresAt > now + 30000`, not just `expiresAt > now`

## Key cn-quickstart Files

Reference these when implementing generation:

| File | Purpose |
|------|---------|
| `quickstart/docker/modules/localnet/compose.yaml` | Core services |
| `quickstart/docker/modules/keycloak/compose.yaml` | OAuth2 |
| `quickstart/docker/modules/splice-onboarding/docker/utils.sh` | Party/user management functions |
| `quickstart/docker/modules/keycloak/conf/data/*.json` | Keycloak realm exports |
| `quickstart/docker/modules/localnet/env/common.env` | Port configuration |
| `quickstart/Makefile` | Build/start/stop commands |

## Dependencies (deno.json imports)

```json
{
  "imports": {
    "@cliffy/command": "jsr:@cliffy/command@^1.0.0",
    "@cliffy/table": "jsr:@cliffy/table@^1.0.0",
    "@std/yaml": "jsr:@std/yaml@^1.0.0",
    "@std/path": "jsr:@std/path@^1.0.0",
    "@std/fs": "jsr:@std/fs@^1.0.0",
    "@std/assert": "jsr:@std/assert@^1.0.0",
    "hono": "jsr:@hono/hono@^4.0.0",
    "zod": "npm:zod@^3.23.0"
  }
}
```

## Example localnet.yaml

```yaml
version: "1.0"

participants:
  app-provider:
    enabled: true
    json_api_port: 3975
    realm: "AppProvider"
    party_hint: "app_provider"
    
  app-user:
    enabled: true
    json_api_port: 2975
    realm: "AppUser"
    party_hint: "app_user"

clients:
  app-provider-validator:
    realm: "AppProvider"
    service_account: true
    client_secret: "AL8648b9SfdTFImq7FV56Vd0KHifHBuC"
    
  app-user-validator:
    realm: "AppUser"
    service_account: true
    client_secret: "6m12QyyGl81d9nABWQXMycZdXho6ejEX"

packages:
  - name: "my-daml-package"
    dar_path: "../daml/.daml/dist/my-package-1.0.0.dar"
    upload_to:
      - "app-provider"
      - "app-user"

discovery:
  port: 3100
  host: "127.0.0.1"
  cache_ttl_seconds: 300
```

---

*Seed AGENTS.md for localnet-tools project. Based on mg-tokenization research. January 2026.*
