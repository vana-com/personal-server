# Personal Server TS (DPv1) — Scaffold Architecture

STATUS: active

---

## Most important takeaways

- This doc defines the scaffold for a TypeScript/Node personal server (`personal-server-ts`) that implements DPv1 personal server responsibilities, aligning with the DPv1 protocol spec (personal server, data sync, local data hierarchy, builder access interface, and MCP integration).
- We propose a modular, testable Node architecture with clear boundaries for grant verification, data registry access, storage adapters, and builder-facing API endpoints.
- **Structure aligns with OpenCode and Gemini-CLI monorepo patterns** — all code under `packages/`, NPM workspaces, esbuild for fast builds.
- Tunneling (FRP) is deferred to a separate design doc.

## Primary references

- DPv1 protocol spec (canonical behavior, scopes, grants, data formats, and server requirements): `data-portability-v1/260121-data-portability-protocol-spec.md`.
- Current DPv0 personal server (legacy reference): https://github.com/vana-com/vana-personal-server.
- Desktop app repo (integration target): https://github.com/vana-com/databridge.
- **OpenCode** (Turborepo + Bun monorepo patterns): https://github.com/anomalyco/opencode
- **Gemini-CLI** (NPM workspaces, service interfaces): https://github.com/google-gemini/gemini-cli

---

## 1) Requirements distilled from the DPv1 spec (must-haves)

### Core Responsibilities
1. **Serve builder data requests** — Respond to authorized `GET /v1/data/{scope}` requests
2. **Verify grant validity** — Check EIP-712 signatures, grantId, and scope permissions
3. **Maintain local data store** — Decrypted data in `~/.vana/data/{scope}/{collectedAt}.json`
4. **Sync to storage backend** — Encrypted uploads to Vana Storage, IPFS, GDrive, Dropbox
5. **Maintain data registry index** — Local index mapping `fileId → (path, scope, collectedAt)`
6. **Access logging** — Timestamped, rotated audit logs of all builder data accesses

### Required API Endpoints
| Endpoint | Purpose |
|----------|---------|
| `POST /v1/data/{scope}` | Ingest new data (from Desktop connectors) |
| `GET /v1/data` | List available scopes (requires Web3Signed auth) |
| `GET /v1/data/{scope}` | Read data (requires grant + Web3Signed auth) |
| `GET /v1/data/{scope}/versions` | List versions (requires Web3Signed auth) |
| `DELETE /v1/data/{scope}` | Delete data (user-only) |
| `GET /v1/grants` | List grants (user-only) |
| `POST /v1/grants/verify` | Verify grant signature |
| `GET /v1/access-logs` | Get access log history |
| `POST /v1/sync/trigger` | Force sync from storage backend |
| `GET /v1/sync/status` | Get sync status |
| `POST /v1/sync/file/{fileId}` | Sync specific file |
| `GET /health` | Health check (unversioned) |

### Authentication Requirements
- **Web3Signed Authorization** — All builder AND user requests: `Authorization: Web3Signed <base64url(json)>.<signature>`
- **EIP-712 Grant Verification** — Recover signer, verify against on-chain grantee
- **Key Derivation** — Master key via EIP-191 signature over `"vana-master-key-v1"`, scope keys via HKDF

### Body Size Limits
| Endpoint | Max Body Size |
|----------|---------------|
| `POST /v1/data/{scope}` | 50 MB (configurable in `server.json`) |
| `POST /v1/grants/verify` | 1 MB |
| All other endpoints | 1 MB (default) |

Connectors SHOULD split data exceeding 50 MB into multiple time-windowed snapshots. Each snapshot is a separate versioned file under the same scope.

### File Existence Model

A data file "exists" for builder queries as soon as the Personal Server has written it locally (atomic: write to temp file, then rename). It does **not** need to be synced to a storage backend or registered on-chain before a builder can read it. Sync and on-chain registration happen asynchronously after local write. This means the Personal Server can serve data immediately after ingest, regardless of sync or gateway availability.

### MCP Server (Required)
- Resources: `vana://files`, `vana://file/{scope}`, `vana://grants`, `vana://schemas`
- Tools: `list_files`, `get_file`, `search_files`
- Auth model:
  - **Local stdio MCP** (Desktop-Bundled): no auth required (trusted local process)
  - **Remote SSE/HTTP MCP** (ODL Cloud, tunneled): `Authorization: Web3Signed ...` (same scheme as builder requests)

### Deployment Targets
| Target | Runtime | Activation |
|--------|---------|------------|
| Desktop-Bundled | Embedded in Tauri | User opens app |
| ODL Cloud | Firecracker MicroVM (Sprites) | HTTP auto-activates |
| Self-Hosted | Docker container | Always running |

### Local Data Hierarchy (Canonical)
```
~/.vana/
├── data/                    # Decrypted data files
│   └── {source}/{scope}/
│       └── {YYYY-MM-DDTHH-mm-ssZ}.json
├── logs/
│   └── access-{YYYY-MM-DD}.log  # Timestamped audit logs (JSON lines, daily rotation)
├── index.db                 # Local registry index (SQLite via better-sqlite3)
└── server.json              # Server config (storage, oauth, sync state)
```

---

## 2) Reference Patterns (from OSS TypeScript/Node repos)

### 1. anomalyco/opencode: MCP Server & Tool Execution
- **Pattern**: Registry-based tool dispatching with dynamic conversion.
- **Reference**: `packages/opencode/src/mcp/index.ts` (Lines 120-148)
- **Relevance**: Direct model for our MCP server integration (`packages/server/src/mcp/`).
- **Code Snippet**:
```typescript
async function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Promise<Tool> {
  return dynamicTool({
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown) => {
      return client.callTool({
        name: mcpTool.name,
        arguments: args as Record<string, unknown>,
      }, CallToolResultSchema, { timeout });
    },
  });
}
```

### 2. standardnotes/server: E2EE & Decoupled Storage
- **Pattern**: Interface-driven storage adapters for E2EE data persistence.
- **Reference**: `packages/tm-core/src/modules/storage/index.ts`
- **Relevance**: Direct model for our `StorageAdapter` interface (`packages/core/src/storage/adapters/`).
- **Code Snippet**:
```typescript
export interface StorageAdapter {
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
}
```

### Key Conclusions for personal-server-ts:
- **Composition Root**: Wire all services in a single `bootstrap.ts` factory function (simple constructor injection, no DI framework).
- **Zod for Schema Validation**: Use Zod to validate both network payloads and local data snapshots against the canonical Schema Registry.
- **Middleware-based Auth**: Isolate EIP-712/Web3Signed verification into dedicated middleware.
- **Storage Adapter Interface**: Standardize on a `StorageAdapter` interface (read/write/delete/list) across all backends.

---

## 3) Proposed repo structure (personal-server-ts)

**Key structural decisions** (aligned with OpenCode & Gemini-CLI patterns):
- All code under `packages/` — no hybrid `packages/` + `src/` split
- NPM workspaces for monorepo management (simpler than Turborepo)
- esbuild for fast builds, TypeScript composite projects for incremental compilation
- **3 packages for v1** — `core`, `server`, `cli`. Extract more packages when boundaries prove themselves through actual code.
- **Tests co-located with source** — `foo.ts` → `foo.test.ts` in same directory
- **Test fixtures as pure factory functions** — not importable constants

```
personal-server-ts/
├── packages/
│   ├── core/                          # Protocol, storage, sync, gateway, schemas
│   │   └── src/
│   │       ├── grants/                # Grant types, verification, EIP-712 parsing
│   │       │   ├── types.ts           # GrantPayload, GrantScope, etc.
│   │       │   ├── verify.ts          # verifyGrant(grantId, signer, requestedScope)
│   │       │   ├── verify.test.ts     # Tests co-located with source
│   │       │   └── eip712.ts          # EIP-712 typed data helpers
│   │       ├── auth/                  # Web3Signed authorization
│   │       │   ├── web3-signed.ts     # Parse & verify Authorization header
│   │       │   └── recover.ts         # Recover signer from signature
│   │       ├── keys/                  # Key derivation (HKDF, scope keys)
│   │       │   ├── master.ts          # Master key from EIP-191 signature
│   │       │   └── derive.ts          # HKDF-SHA256 scope key derivation
│   │       ├── scopes/                # Scope parsing & validation
│   │       │   ├── parse.ts           # Parse "instagram.profile" → segments
│   │       │   └── match.ts           # Scope subset matching
│   │       ├── gateway/               # DP RPC Gateway client (centralized chain operations)
│   │       │   ├── client.ts          # GatewayClient class (all chain ops)
│   │       │   ├── schemas.ts         # Schema registry lookups
│   │       │   └── files.ts           # File record operations
│   │       ├── schemas/               # Zod schemas for all data types
│   │       │   ├── data-file.ts       # DataFile schema (spec 5.2)
│   │       │   ├── server-config.ts   # ~/.vana/server.json schema
│   │       │   └── grant.ts           # Grant payload schema
│   │       ├── errors/                # Typed error catalog (maps to spec §8.2)
│   │       │   └── catalog.ts        # ProtocolError base + typed subclasses
│   │       ├── config/                # Config loading & validation
│   │       │   ├── loader.ts          # Load from ~/.vana/server.json
│   │       │   └── defaults.ts        # Default configuration
│   │       ├── logger/                # Structured logging (pino)
│   │       │   └── index.ts           # Logger setup with pino + pino-pretty
│   │       ├── storage/               # Storage layer
│   │       │   ├── adapters/          # Storage backend implementations
│   │       │   │   ├── interface.ts   # StorageAdapter interface
│   │       │   │   ├── local.ts       # Local filesystem (no encryption)
│   │       │   │   ├── vana.ts        # Vana Storage (encrypted)
│   │       │   │   ├── ipfs.ts        # IPFS (content-addressed)
│   │       │   │   ├── gdrive.ts      # Google Drive (OAuth)
│   │       │   │   └── dropbox.ts     # Dropbox (OAuth)
│   │       │   ├── hierarchy/         # ~/.vana/data manager
│   │       │   │   ├── paths.ts       # Scope → path mapping
│   │       │   │   └── versioning.ts  # collectedAt-based versioning
│   │       │   ├── index/             # Local registry index (SQLite via better-sqlite3)
│   │       │   │   ├── types.ts       # IndexEntry: fileId → (path, scope, collectedAt)
│   │       │   │   ├── manager.ts     # Index CRUD operations (SQLite queries)
│   │       │   │   └── schema.ts      # SQLite table definitions + migrations
│   │       │   ├── encryption/        # Encryption/decryption
│   │       │   │   ├── encrypt.ts     # Encrypt data file with scope key
│   │       │   │   └── decrypt.ts     # Decrypt blob → data file
│   │       │   └── migrations/        # Index schema migrations
│   │       │       └── runner.ts      # Migration execution
│   │       ├── sync/                  # Sync engine
│   │       │   ├── engine/            # Sync orchestration
│   │       │   │   ├── sync-manager.ts # Main sync loop
│   │       │   │   └── cursor.ts      # lastProcessedTimestamp tracking
│   │       │   ├── workers/           # Background workers
│   │       │   │   ├── upload.ts      # Encrypt + upload to backend
│   │       │   │   └── download.ts    # Download + decrypt from backend
│   │       │   └── queue/             # Sync job queue
│   │       │       └── file-queue.ts  # Pending uploads/downloads
│   │       └── test-utils/            # Testing infrastructure (exported for server/ tests)
│   │           ├── mocks/
│   │           │   ├── storage.ts     # Mock storage adapter
│   │           │   ├── gateway.ts     # Mock DP RPC responses
│   │           │   └── wallet.ts      # Test wallet/signatures
│   │           └── fixtures.ts        # Factory functions: createTestGrant(), createTestDataFile()
│   │
│   ├── server/                        # HTTP server (DPv1 API)
│   │   └── src/
│   │       ├── app.ts                 # Hono app setup
│   │       ├── routes/                # API route handlers
│   │       │   ├── data.ts            # /v1/data endpoints
│   │       │   ├── grants.ts          # /v1/grants endpoints
│   │       │   ├── sync.ts            # /v1/sync endpoints
│   │       │   ├── access-logs.ts     # /v1/access-logs endpoint
│   │       │   └── health.ts          # /health (unversioned)
│   │       ├── middleware/            # Request middleware
│   │       │   ├── cors.ts            # CORS (allow all origins)
│   │       │   ├── web3-auth.ts       # Web3Signed verification
│   │       │   ├── owner-check.ts     # Verify signer === server owner
│   │       │   ├── builder-check.ts   # Verify signer is registered Builder
│   │       │   ├── grant-check.ts     # Grant enforcement for data reads
│   │       │   └── access-log.ts      # Audit logging middleware
│   │       └── mcp/                   # MCP server integration
│   │           ├── server.ts          # MCP server setup
│   │           ├── resources.ts       # vana://files, vana://grants, etc.
│   │           └── tools.ts           # list_files, get_file, search_files
│   │
│   └── cli/                           # CLI commands
│       └── src/
│           ├── index.ts               # CLI entry point (yargs)
│           └── commands/
│               ├── start.ts           # Start server
│               ├── sync.ts            # Trigger sync
│               └── register.ts        # Register on-chain
│
├── docker/                            # Container configs
│   ├── Dockerfile                     # Production image
│   └── docker-compose.yml             # Local development
├── scripts/                           # Setup helpers
│   └── register-server.ts             # On-chain registration (uses GatewayClient)
└── docs/                              # Documentation
```

### Component Mapping to DPv1 Requirements

| DPv1 Requirement | Package | Key Files |
|------------------|---------|-----------|
| Grant verification | `core/` | `grants/verify.ts`, `auth/web3-signed.ts` |
| Key derivation | `core/` | `keys/master.ts`, `keys/derive.ts` |
| Local data hierarchy | `core/` | `storage/hierarchy/paths.ts`, `storage/hierarchy/versioning.ts` |
| Storage backends | `core/` | `storage/adapters/*.ts` |
| Registry index (SQLite) | `core/` | `storage/index/manager.ts`, `storage/index/schema.ts` |
| Error catalog | `core/` | `errors/catalog.ts` |
| Data sync | `core/` | `sync/engine/sync-manager.ts`, `sync/workers/*.ts` |
| DP RPC polling | `core/` | `gateway/client.ts`, `sync/engine/cursor.ts` |
| Builder data API | `server/` | `routes/data.ts`, `middleware/*.ts` |
| MCP server | `server/` | `mcp/*.ts` |
| Access logging | `server/` | `middleware/access-log.ts` |
| Gateway operations | `core/` | `gateway/client.ts` |

---

## 4) API Interface & Authorization

This section elaborates on the API endpoints and authorization model, extracted from the DPv1 protocol specification (section 4.1.9).

### 4.1) Complete API Endpoint Reference

**Summary Table:**

| Endpoint | Method | Auth Required | Grant Required | Caller | Purpose |
|----------|--------|---------------|----------------|--------|---------|
| `/v1/data/{scope}` | POST | Web3Signed (owner) | No | Desktop App | Ingest new data |
| `/v1/data` | GET | Web3Signed (builder) | No | Builder | List available scopes |
| `/v1/data/{scope}` | GET | Web3Signed (builder) | **Yes** | Builder/User | Read data file |
| `/v1/data/{scope}/versions` | GET | Web3Signed (builder) | No | Builder | List versions |
| `/v1/data/{scope}` | DELETE | Web3Signed (owner) | No | User only | Delete data |
| `/v1/grants` | GET | Web3Signed (owner) | No | User only | List grants |
| `/v1/grants/verify` | POST | None | No | Any | Verify grant signature |
| `/v1/access-logs` | GET | Web3Signed (owner) | No | User only | Get access history |
| `/v1/sync/trigger` | POST | Web3Signed (owner) | No | User only | Force sync |
| `/v1/sync/status` | GET | Web3Signed (owner) | No | User only | Get sync status |
| `/v1/sync/file/{fileId}` | POST | Web3Signed (owner) | No | User only | Sync specific file |
| `/health` | GET | None | No | Any | Health check |

---

#### 4.1.1) POST /v1/data/{scope} — Ingest New Data

Ingests raw data from Desktop connectors and constructs the full Data File envelope.

**Request:**
```http
POST /v1/data/{scope}
Content-Type: application/json
Authorization: Web3Signed <base64url(json)>.<signature>

{
  // Raw JSON data payload (the "data" field content only)
  // Max body size: 50 MB
}
```

**Query Parameters:** None

**Processing Steps:**
1. Look up the `schemaId` for the given scope via Gateway (`GET /v1/schemas?scope={scope}`)
2. Reject with `400 Bad Request` if no schema is registered for the scope
3. Validate the request body against the schema definition
4. Reject with `400 Bad Request` if validation fails
5. Generate `collectedAt` timestamp (current UTC time)
6. Construct the full Data File envelope (see response format in 4.1.3)
7. Store locally in `~/.vana/data/{scope}/{collectedAt}.json`
8. Return `201 Created` immediately
9. Async (background): encrypt, upload to storage backend, register file in `DataRegistry` via DP RPC

**Response (201 Created):**
```json
{
  "scope": "instagram.profile",
  "collectedAt": "2026-01-21T10:00:00Z",
  "status": "syncing"
}
```

**Error Responses:**
- `400 Bad Request` — No schema registered for scope, or validation failed
- `413 Content Too Large` — Request body exceeds 50 MB

**Note on localhost-only deployments:** When the server is only accessible on localhost (Desktop-Bundled without tunneling), the `POST /v1/data/{scope}` endpoint MAY skip Web3Signed auth. For ODL Cloud and tunneled deployments, owner auth is required.

---

#### 4.1.2) GET /v1/data — List Available Scopes

Lists available scopes and latest version metadata for builders.

**Request:**
```http
GET /v1/data?scopePrefix={scopePrefix}&limit={limit}&offset={offset}
Authorization: Web3Signed <base64url(json)>.<signature>
```

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `scopePrefix` | string | No | Filter by scope prefix (e.g., `instagram`) |
| `limit` | number | No | Pagination limit (default: 50) |
| `offset` | number | No | Pagination offset (default: 0) |

**Web3Signed Payload:**
```json
{
  "aud": "https://user-abc.server.vana.com",
  "method": "GET",
  "uri": "/v1/data?scopePrefix=instagram&limit=50&offset=0",
  "bodyHash": "",
  "iat": 1737500000,
  "exp": 1737500300
}
```

**Response (200 OK):**
```json
{
  "scopes": [
    {
      "scope": "instagram.profile",
      "latestCollectedAt": "2026-01-21T10:00:00Z",
      "versionCount": 3
    }
  ],
  "total": 5,
  "limit": 50,
  "offset": 0
}
```

---

#### 4.1.3) GET /v1/data/{scope} — Read Data File

Returns the decrypted data file JSON for the requested scope. Requires a valid grant for builder access.

**Request:**
```http
GET /v1/data/{scope}?fileId={fileId}&at={ISO8601}
Authorization: Web3Signed <base64url(json)>.<signature>
```

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `fileId` | string | No | Specific version by DataRegistry fileId |
| `at` | ISO8601 | No | Specific version by collectedAt (closest ≤ at) |

Default: latest by `collectedAt`

**Web3Signed Payload (must include grantId):**
```json
{
  "aud": "https://user-abc.server.vana.com",
  "method": "GET",
  "uri": "/v1/data/instagram.profile",
  "bodyHash": "",
  "iat": 1737500000,
  "exp": 1737500300,
  "grantId": "0x..."
}
```

**Response (200 OK):**
```json
{
  "$schema": "<schema URL from registry>",
  "version": "1.0",
  "scope": "instagram.profile",
  "collectedAt": "2026-01-21T10:00:00Z",
  "data": {
    "username": "alice",
    "displayName": "Alice Smith",
    "bio": "...",
    "followers": 1234,
    "following": 567
  }
}
```

**Error Responses:**
- `401 MISSING_AUTH` — No Authorization header provided
- `401 INVALID_SIGNATURE` — Signature recovery failed
- `401 UNREGISTERED_BUILDER` — Signer not registered as Builder
- `403 GRANT_REQUIRED` — Data read without valid grant
- `403 GRANT_EXPIRED` — Grant has expired
- `403 GRANT_REVOKED` — Grant has been revoked
- `403 SCOPE_MISMATCH` — Requested scope not covered by grant

---

#### 4.1.4) GET /v1/data/{scope}/versions — List Versions

Lists available versions (metadata only) for a given scope.

**Request:**
```http
GET /v1/data/{scope}/versions?limit={limit}&offset={offset}
Authorization: Web3Signed <base64url(json)>.<signature>
```

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `limit` | number | No | Pagination limit (default: 50) |
| `offset` | number | No | Pagination offset (default: 0) |

**Web3Signed Payload:**
```json
{
  "aud": "https://user-abc.server.vana.com",
  "method": "GET",
  "uri": "/v1/data/instagram.profile/versions?limit=50&offset=0",
  "bodyHash": "",
  "iat": 1737500000,
  "exp": 1737500300
}
```

**Response (200 OK):**
```json
{
  "scope": "instagram.profile",
  "versions": [
    {
      "fileId": "0x...",
      "collectedAt": "2026-01-22T10:00:00Z"
    },
    {
      "fileId": "0x...",
      "collectedAt": "2026-01-21T10:00:00Z"
    }
  ],
  "total": 2,
  "limit": 50,
  "offset": 0
}
```

---

#### 4.1.5) DELETE /v1/data/{scope} — Delete Data

User-only action for removing local/decrypted data and triggering storage cleanup in the storage backend.

**Request:**
```http
DELETE /v1/data/{scope}
Authorization: Web3Signed <base64url(json)>.<signature>
```
(Owner auth — signer must match `server.address`)

**Response (204 No Content):** Empty body

---

#### 4.1.6) GET /v1/grants — List Grants

Lists all grants for the authenticated user.

**Request:**
```http
GET /v1/grants
Authorization: Web3Signed <base64url(json)>.<signature>
```
(Owner auth — signer must match `server.address`)

**Response (200 OK):**
```json
{
  "grants": [
    {
      "grantId": "0x...",
      "builder": "0x...",
      "scopes": ["instagram.profile", "instagram.likes"],
      "expiresAt": 0,
      "createdAt": "2026-01-21T10:00:00Z"
    }
  ]
}
```

---

#### 4.1.7) POST /v1/grants/verify — Verify Grant Signature

Verifies a grant signature. Public endpoint, no authentication required.

**Request:**
```http
POST /v1/grants/verify
Content-Type: application/json

{
  "grantId": "0x...",
  "signature": "0x..."
}
```

**Response (200 OK):**
```json
{
  "valid": true,
  "user": "0x...",
  "builder": "0x...",
  "scopes": ["instagram.profile"],
  "expiresAt": 0
}
```

---

#### 4.1.8) GET /v1/access-logs — Get Access History

Returns the access log history for the authenticated user. Matches spec section 5.4.

**Request:**
```http
GET /v1/access-logs?limit={limit}&offset={offset}
Authorization: Web3Signed <base64url(json)>.<signature>
```
(Owner auth — signer must match `server.address`)

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `limit` | number | No | Pagination limit (default: 50) |
| `offset` | number | No | Pagination offset (default: 0) |

**Response (200 OK):**
```json
{
  "logs": [
    {
      "logId": "uuid",
      "grantId": "0x...",
      "builder": "0x...",
      "action": "read",
      "scope": "instagram.profile",
      "timestamp": "2026-01-21T10:00:00Z",
      "ipAddress": "1.2.3.4",
      "userAgent": "BuilderSDK/1.0"
    }
  ],
  "total": 10,
  "limit": 50,
  "offset": 0
}
```

---

#### 4.1.9) POST /v1/sync/trigger — Force Sync

Triggers a force sync from the storage backend.

**Request:**
```http
POST /v1/sync/trigger
Authorization: Web3Signed <base64url(json)>.<signature>
```
(Owner auth — signer must match `server.address`)

**Response (202 Accepted):**
```json
{
  "status": "started",
  "message": "Sync triggered"
}
```

---

#### 4.1.10) GET /v1/sync/status — Get Sync Status

Returns the current sync status including last sync time, cursor position, and any pending operations.

**Request:**
```http
GET /v1/sync/status
Authorization: Web3Signed <base64url(json)>.<signature>
```
(Owner auth — signer must match `server.address`)

**Response (200 OK):**
```json
{
  "lastSync": "2026-01-21T10:00:00Z",
  "lastProcessedTimestamp": 1737453600,
  "pendingFiles": 2,
  "errors": []
}
```

---

#### 4.1.11) POST /v1/sync/file/{fileId} — Sync Specific File

Triggers sync for a specific file from the storage backend.

**Request:**
```http
POST /v1/sync/file/{fileId}
Authorization: Web3Signed <base64url(json)>.<signature>
```
(Owner auth — signer must match `server.address`)

**Response (202 Accepted):**
```json
{
  "fileId": "0x...",
  "status": "started"
}
```

---

#### 4.1.12) GET /health — Health Check

Public health check endpoint. No authentication required. Unversioned path.

**Request:**
```http
GET /health
```

**Response (200 OK):**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": {
    "registration": { "status": "healthy", "registered": true, "trusted": true },
    "storage": { "status": "healthy", "backend": "vana" },
    "gateway": { "status": "healthy", "latencyMs": 42 },
    "sync": { "status": "healthy", "lastSync": "2026-01-21T10:00:00Z", "pendingFiles": 0 }
  }
}
```

The `registration` check verifies the server is registered on-chain and trusted by the user (via Gateway lookup, cached on startup).

Returns 200 if core is running, even if subsystems are degraded (use `"status": "degraded"` per-check). This lets load balancers keep the server in rotation while operators diagnose subsystem issues.

---

### 4.2) Authorization Model

The personal server uses **Web3Signed authorization for all authenticated endpoints** — both builder and user requests. This eliminates session state, cookies, and token management. The Desktop App signs requests with the user's wallet (via Privy); builders sign with their registered wallet.

#### Caller Types

| Caller Type | Authentication | Grant Required | Use Cases |
|-------------|----------------|----------------|-----------|
| **User (Desktop App/UI)** | Web3Signed + owner check | No | Managing data, viewing grants, triggering sync |
| **Builder (External)** | Web3Signed + builder check | Yes (for data reads) | Accessing user data via granted permissions |
| **Public** | None | No | Health check, grant verification |

#### How User Auth Works

1. Desktop App signs requests with the user's wallet using the same Web3Signed format as builders
2. Personal Server recovers the signer address from the `Authorization` header
3. Server checks `recoveredAddress === config.server.address` (the server owner's wallet)
4. No session state, no cookies, no token issuance, no expiry management

#### Web3Signed Header Format

All builder and user requests must include the `Authorization` header:

```
Authorization: Web3Signed <base64url(json)>.<signature>
```

#### Web3Signed Payload Structure

```json
{
  "aud": "https://user-abc.server.vana.com",
  "method": "GET",
  "uri": "/v1/data/instagram.profile",
  "bodyHash": "",
  "iat": 1737500000,
  "exp": 1737500300,
  "grantId": "0x..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `aud` | string | Yes | Target server origin (must match request) |
| `method` | string | Yes | HTTP method (must match request) |
| `uri` | string | Yes | Request path (must match request) |
| `bodyHash` | string | Yes | SHA-256 hash of request body (empty string if no body) |
| `iat` | number | Yes | Issued-at timestamp (Unix seconds) |
| `exp` | number | Yes | Expiration timestamp (Unix seconds) |
| `grantId` | string | For data reads | Grant ID (required only for `GET /v1/data/{scope}`) |

#### Web3Signed Verification Steps

The server performs the following verification for all authenticated requests:

1. **Recover signer** — Recover the Ethereum address from the signature using EIP-191 personal sign recovery
2. **Verify audience** — Confirm `aud` matches the server's origin exactly
3. **Verify method** — Confirm `method` matches the HTTP request method
4. **Verify URI** — Confirm `uri` matches the HTTP request path
5. **Verify timing** — Confirm `iat` and `exp` are within 5-minute clock skew tolerance
6. **Route to caller check**:
   - **User endpoints** → Verify `recoveredAddress === config.server.address` (owner check)
   - **Builder endpoints** → Verify `isRegisteredBuilder(recoveredAddress)` via Gateway
7. **For data reads** — Verify `grantId` is present and its scope covers the requested scope

### 4.3) Grant Enforcement

For endpoints that require grant verification (`GET /v1/data/{scope}`), the server performs additional checks:

#### Grant Verification Flow

Grant verification is split into local-only steps (no network) and a single remote check:

**Local-only (no network required):**

1. **Extract grant ID** — Parse `grantId` from the Web3Signed payload
2. **Signature verification** — Recover the signer from the EIP-712 grant signature; confirm the grant was signed by the user who owns this Personal Server. Pure crypto, no network.
3. **Expiry check** — Read `expiresAt` from the signed grant payload; reject if expired. No network.
4. **Scope check** — Read `scopes` from the signed grant payload; confirm the requested scope is a subset of the granted scopes (e.g., `instagram.profile` ⊆ `instagram.*`). No network.
5. **Grantee check** — Confirm the request signer (from the Web3Signed `Authorization` header) matches the `builder` address in the signed grant payload. No network.

**Remote (requires Gateway):**

6. **Revocation check** — Query the Gateway (`GET /v1/grants/{grantId}`) to confirm the grant has not been revoked. This is the only step that requires a network call.

**Post-verification:**

7. **Log access** — Append access record to the audit log (`~/.vana/logs/access-{date}.log`)

#### Scope Subset Matching

Scope matching follows hierarchical rules:

- `instagram.profile` matches `instagram.profile` (exact match)
- `instagram.profile` matches `instagram.*` (wildcard)
- `instagram.profile` matches `*` (global wildcard)
- `instagram.profile` does NOT match `twitter.*`

### 4.4) Endpoint Classification

| Category | Endpoints | Auth | Notes |
|----------|-----------|------|-------|
| **Builder (External)** | `GET /v1/data`, `GET /v1/data/{scope}`, `GET /v1/data/{scope}/versions` | Web3Signed + builder check | Grant required for data reads |
| **User (Owner)** | `DELETE /v1/data/*`, `GET /v1/grants`, `GET /v1/access-logs`, `/v1/sync/*` | Web3Signed + owner check | User-only operations |
| **Data Ingest** | `POST /v1/data/{scope}` | Web3Signed (owner) or none (localhost-only) | Desktop App |
| **Public** | `/health`, `POST /v1/grants/verify` | None | No auth required |

### 4.5) Implementation Notes

#### Middleware Stack

**Builder-facing endpoints:**
```
Request → CORS → RateLimit (future) → Web3SignedAuth → BuilderCheck → GrantCheck (if data read) → AccessLog → Handler → Response
```

**User-facing endpoints:**
```
Request → CORS → RateLimit (future) → Web3SignedAuth → OwnerCheck → Handler → Response
```

**Public endpoints:**
```
Request → CORS → Handler → Response
```

**CORS**: Allow all origins (`Access-Control-Allow-Origin: *`). Since all authenticated requests use the `Authorization` header (not cookies), permissive CORS is safe — the auth token is the security boundary, not the origin.

**Rate limiting**: Will be added in a later phase. Document placeholder in middleware stack.

#### Error Responses

| Status | Error Code | Description |
|--------|------------|-------------|
| 401 | `MISSING_AUTH` | No Authorization header provided |
| 401 | `INVALID_SIGNATURE` | Signature recovery failed |
| 401 | `UNREGISTERED_BUILDER` | Signer not registered as Builder |
| 401 | `NOT_OWNER` | Signer does not match server owner address |
| 401 | `EXPIRED_TOKEN` | Token `exp` has passed |
| 403 | `GRANT_REQUIRED` | Data read without valid grant |
| 403 | `GRANT_EXPIRED` | Grant has expired |
| 403 | `GRANT_REVOKED` | Grant has been revoked |
| 403 | `SCOPE_MISMATCH` | Requested scope not covered by grant |
| 413 | `CONTENT_TOO_LARGE` | Request body exceeds size limit |

---

## 4.6) Gateway Client (Centralized Chain Operations)

All chain-touching operations (server registration, grant lookups, file registry operations, schema queries, builder verification) are centralized in a single `GatewayClient` class. This keeps chain interactions in one place without premature abstraction.

### GatewayClient

```typescript
// packages/core/src/gateway/client.ts
export class GatewayClient {
  constructor(private baseUrl: string) {}

  // Server operations
  async registerServer(params: RegisterServerParams): Promise<ServerRegistration>
  async getServer(address: string): Promise<ServerInfo | null>

  // Grant operations
  async getGrant(grantId: string): Promise<Grant | null>
  async verifyGrant(grantId: string, grantee: string, scope: string): Promise<GrantVerification>

  // File registry operations
  async registerFile(params: RegisterFileParams): Promise<FileRegistration>
  async getFile(fileId: string): Promise<FileRecord | null>
  async listFiles(owner: string, cursor?: string): Promise<FileListResult>

  // Schema operations
  async getSchema(schemaId: string): Promise<Schema | null>
  async getSchemaForScope(scope: string): Promise<Schema | null>

  // Builder operations
  async isRegisteredBuilder(address: string): Promise<boolean>
  async getBuilder(address: string): Promise<Builder | null>
}
```

### Testing

Mock the `GatewayClient` via dependency injection — pass the client instance to consumers rather than importing a singleton:

```typescript
// In tests: use msw/nock to intercept HTTP calls,
// or a simple mock object:
const mockGateway = {
  getGrant: vi.fn().mockResolvedValue(testGrant),
  isRegisteredBuilder: vi.fn().mockResolvedValue(true),
  // ...
}
```

### Configuration

In `~/.vana/server.json`:

```json
{
  "gatewayUrl": "https://rpc.vana.org"
}
```

### Usage in Scripts

The `register-server.ts` script uses the `GatewayClient` directly:

```typescript
import { GatewayClient } from '@personal-server/core/gateway'
import { loadConfig } from '@personal-server/core/config'

const config = await loadConfig()
const gateway = new GatewayClient(config.gatewayUrl)

await gateway.registerServer({
  owner: wallet.address,
  endpoint: config.publicUrl,
  metadata: { version: '1.0.0' }
})
```

---

## 5) Architectural Decisions

### Tooling Choices (Confirmed)

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| **Monorepo Tool** | NPM workspaces | Simpler than Turborepo, matches Gemini-CLI |
| **Runtime** | Node.js | Tauri desktop app bundles Node; consistent across all deployment targets |
| **HTTP Framework** | Hono via `@hono/node-server` | Lightweight, TypeScript-first (OpenCode pattern) |
| **DI Pattern** | Composition root (`bootstrap.ts`) | Simple constructor injection, no DI framework |
| **Storage** | Interface + adapters + migrations | Standard Notes pattern + OpenCode migrations |
| **CLI** | Yargs | Standard, skip Ink for simplicity |
| **Testing** | Vitest + co-located tests | Gemini-CLI pattern; test-utils in `core/src/test-utils/` |
| **Build** | esbuild + TypeScript composite | Fast builds, incremental compilation |
| **Logging** | pino + pino-pretty | Fast structured logging, human-readable in dev |

### Logging

**Library**: [pino](https://github.com/pinojs/pino) — fast, structured, JSON output by default.

**Human-readable in dev**: `pino-pretty` transport transforms JSON log lines into colorized output:

```
[10:32:15.023] INFO: Server started
    port: 8080
    version: "1.0.0"
[10:32:15.150] INFO: Sync engine ready
    lastProcessedTimestamp: "2026-01-21T10:00:00Z"
    pendingFiles: 0
[10:32:16.042] INFO: Builder data access
    builder: "0xabc..."
    scope: "instagram.profile"
    grantId: "0x123..."
    responseTimeMs: 12
```

**Production**: Raw JSON lines (one JSON object per line).

**Log levels**:

| Level | Use |
|-------|-----|
| `fatal` | Server cannot start (missing config, port in use) |
| `error` | Operation failed (sync error, storage write failure) |
| `warn` | Degraded state (gateway unreachable, retrying) |
| `info` | Significant events (server start/stop, data access, sync complete) |
| `debug` | Detailed flow (request parsing, grant verification steps) |

**Log destinations**:
- **stdout**: All application logs (standard for containers and desktop apps)
- **`~/.vana/logs/access-{YYYY-MM-DD}.log`**: Access audit log only (JSON lines format per spec §5.4, append-only, daily rotation, separate from application logs)

**Log file rotation**: Access logs are written to daily timestamped files (`access-2026-01-21.log`, `access-2026-01-22.log`, etc.) to prevent any single file from growing unbounded. Old log files are retained indefinitely (cleanup is a user/ops concern).

**Configuration** in `server.json`:
```json
{
  "logging": {
    "level": "info",
    "pretty": false
  }
}
```

`pretty: true` is auto-detected in development (when `NODE_ENV !== 'production'`).

### Server Lifecycle & Recovery

#### Startup Sequence

1. Load config from `~/.vana/server.json`
2. Derive keys (master key → scope keys)
3. Initialize storage adapter
4. **Start HTTP server** (immediately available — serves locally-stored data)
5. Start sync engine in background (resume from `lastProcessedTimestamp`)

Requests for scopes not yet synced return whatever is locally available. This is critical for ODL Cloud cold start (~1-2s target).

#### Graceful Shutdown (SIGTERM/SIGINT)

1. Stop accepting new HTTP requests
2. Drain in-flight requests (5s timeout)
3. Flush pending sync queue to disk (serialize pending `fileId` list)
4. Close storage adapter connections
5. Write `lastProcessedTimestamp` to `server.json`

#### Crash Recovery (process restart)

1. Sync engine resumes from `lastProcessedTimestamp` in `server.json` — any file already fully written locally is skipped (file exists check)
2. Partially written files (no matching index entry) are deleted on startup and re-downloaded
3. Upload queue is rebuilt by scanning local files not yet in the registry index

#### Design Principle

All operations must be idempotent. The sync cursor (`lastProcessedTimestamp`) is the only recovery checkpoint. File writes are atomic (write to temp file, then rename).

### Key Patterns to Adopt

**From OpenCode:**
1. **Lazy initialization** — Use for expensive resources (gateway client, storage adapters). Each lazy-initialized resource must register a cleanup handler for graceful shutdown.
   ```typescript
   import { lazy } from "@/util/lazy"
   const registryIndex = lazy(async () => await loadRegistryFromGateway())
   ```
2. **Namespace pattern** — `Storage.*`, `Sync.*`, `Grant.*` for module organization
3. **File-based storage with migrations** — JSON files + migration runner
4. **Error catalog** — Typed errors mapping to spec §8.2 error codes:
   ```typescript
   // core/src/errors/catalog.ts
   export class ProtocolError extends Error {
     constructor(
       public readonly code: number,
       public readonly errorCode: string,
       message: string,
       public readonly details?: Record<string, unknown>
     ) { super(message) }
   }
   export class GrantExpiredError extends ProtocolError { /* 403 GRANT_EXPIRED */ }
   export class GrantRevokedError extends ProtocolError { /* 403 GRANT_REVOKED */ }
   export class ScopeMismatchError extends ProtocolError { /* 403 SCOPE_MISMATCH */ }
   export class MissingAuthError extends ProtocolError { /* 401 MISSING_AUTH */ }
   export class InvalidSignatureError extends ProtocolError { /* 401 INVALID_SIGNATURE */ }
   export class UnregisteredBuilderError extends ProtocolError { /* 401 UNREGISTERED_BUILDER */ }
   export class NotOwnerError extends ProtocolError { /* 401 NOT_OWNER */ }
   export class ContentTooLargeError extends ProtocolError { /* 413 CONTENT_TOO_LARGE */ }
   ```

**From Gemini-CLI:**
1. **Composition root** — All services wired in a single `bootstrap.ts` factory function:
   ```typescript
   // server/src/bootstrap.ts
   export function createServer(config: ServerConfig) {
     const gateway = new GatewayClient(config.gatewayUrl)
     const storage = createStorageAdapter(config.storage)
     const index = new IndexManager(config.dataDir)
     const sync = new SyncManager(gateway, storage, index)
     return new App({ gateway, storage, index, sync })
   }
   ```
2. **Service interface pattern** — `interface StorageService` + concrete implementations
   ```typescript
   interface StorageService {
     read(path: string): Promise<Buffer | null>
     write(path: string, data: Buffer): Promise<void>
     exists(path: string): Promise<boolean>
   }
   class LocalFileSystemStorage implements StorageService { ... }
   class VanaCloudStorage implements StorageService { ... }
   ```
3. **Test utilities** — Shared mocks and factory-function fixtures in `core/src/test-utils/`
   ```typescript
   // core/src/test-utils/fixtures.ts
   export function createTestGrant(overrides?: Partial<Grant>): Grant { ... }
   export function createTestDataFile(overrides?: Partial<DataFile>): DataFile { ... }
   ```
4. **Three-tier separation** — CLI (UI) → Server (API) → Core (Business Logic)

**From DPv1 Spec:**
1. **Web3Signed middleware** — Required for all builder AND user requests
2. **Grant enforcement** — Scope subset matching, access logging
3. **Local index** — `fileId → (path, scope, collectedAt)` for fast lookups
4. **Cursor-based sync** — `lastProcessedTimestamp` for DP RPC polling
5. **MCP resources/tools** — Required for AI assistant integration

### Configuration Hierarchy

Multi-layer configuration (Gemini-CLI pattern):
1. **Global**: `~/.vana/server.json`
2. **Per-deployment**: Environment variables
3. **Runtime**: API overrides

---

## 6) Gaps Addressed from Original Scaffold

| Original Issue | Resolution |
|----------------|------------|
| Hybrid `packages/` + `src/` structure | All code under `packages/` |
| Too many packages (7) | Reduced to 3: `core`, `server`, `cli` |
| Missing test infrastructure | Added `core/src/test-utils/` with factory-function fixtures |
| No storage migration system | Added `core/src/storage/migrations/` |
| Event bus over-engineering | Removed — use direct function calls |
| No auth modules | Added `core/src/auth/` |
| No key derivation | Added `core/src/keys/` |
| No gateway client | Added `core/src/gateway/` |
| Unspecified monorepo tool | NPM workspaces |
| Unspecified build tool | esbuild + TypeScript composite |
| Session auth unspecified | Web3Signed + owner check (same as builder auth) |
| No CORS handling | CORS middleware allowing all origins |
| No body size limits | 50 MB for data ingest, 1 MB default |
| No server lifecycle | Startup sequence, graceful shutdown, crash recovery |
| No logging spec | pino + pino-pretty, daily rotated access logs |
| ChainAdapter premature abstraction | Concrete `GatewayClient` class |
| FRP tunneling under-specified | Deferred to separate design doc |
| MCP auth mismatch | Local stdio = no auth; remote SSE/HTTP = Web3Signed |
| No API versioning | `/v1/` prefix on all endpoints (except `/health`) |
| Shallow health check | Expanded with registration + subsystem checks |
| Grant cache unspecified | Removed — grant verification is local-only (EIP-712 signature, expiry, scope, grantee); only revocation check requires remote Gateway lookup |
| Local index storage unspecified | SQLite via `better-sqlite3` at `~/.vana/index.db` |
| No error catalog | Typed `ProtocolError` hierarchy mapping to spec §8.2 |
| DI pattern unspecified | Composition root factory in `server/src/bootstrap.ts` |
| Startup blocks on sync | HTTP starts first, sync runs in background |
| File existence model unclear | Files available to readers immediately after local write |
| Runtime unspecified | Node.js (Tauri bundles Node; consistent across all targets) |
| Access log format unspecified | JSON lines per spec §5.4, daily rotation |

---

## 7) Implementation plan (phased scaffold)

Phases are ordered to deliver an end-to-end working slice as early as possible (a locally-serving Personal Server that a builder can read from).

**Phase 0: Skeleton**
- Repo scaffold with NPM workspaces (3 packages: `core`, `server`, `cli`)
- Package structure with tsconfig references
- Hono HTTP server (via `@hono/node-server`) with `/health` endpoint
- Config loader with Zod validation
- Structured logging setup (pino + pino-pretty)
- Server lifecycle (startup, graceful shutdown)
- Composition root (`server/src/bootstrap.ts`)

**Phase 1: Local Data Store + Ingest**
- Local filesystem hierarchy manager (`core/src/storage/hierarchy/`)
- SQLite registry index via `better-sqlite3` (`core/src/storage/index/`)
- `POST /v1/data/{scope}` endpoint (no sync, no encryption)
- File existence model: data available to readers immediately after local write

**Phase 2: Auth + Builder Read Path**
- Web3Signed authorization parsing (`core/src/auth/`)
- Builder check middleware (verify registered builder via Gateway)
- Grant enforcement middleware (4-step local verification + remote revocation check)
- Scope parsing and wildcard matching (`core/src/scopes/`)
- `GET /v1/data/{scope}`, `GET /v1/data`, `GET /v1/data/{scope}/versions` endpoints
- Access logging middleware (JSON lines, daily rotated files)
- Error catalog (`core/src/errors/`)

**Phase 3: Owner Endpoints + Gateway Integration**
- Owner check middleware (signer === server owner)
- `DELETE /v1/data/{scope}`, `GET /v1/grants`, `GET /v1/access-logs` endpoints
- `/v1/sync/trigger`, `/v1/sync/status`, `/v1/sync/file/{fileId}` endpoints
- GatewayClient (`core/src/gateway/`)
- Schema lookups for data ingest validation
- Key derivation (master key, scope keys) (`core/src/keys/`)

**Phase 4: Sync Engine + Storage Backends**
- Cursor-based sync loop (`core/src/sync/`)
- Upload/download workers
- Encryption/decryption with scope keys
- Storage adapter interface + local + Vana Storage implementations
- File queue for pending operations
- Crash recovery (idempotent resume)

**Phase 5: Operational Hardening**
- OpenAPI spec generation
- Metrics and observability
- Rate limiting middleware

**Phase 6: MCP Server**
- MCP resources (`vana://files`, `vana://grants`)
- MCP tools (`list_files`, `get_file`, `search_files`)
- Auth: local stdio MCP = no auth; remote SSE/HTTP MCP = `Authorization: Web3Signed ...` (same scheme as builder requests)

**Phase 7: Tunneling + Desktop Integration** (deferred — separate design doc)
- FRP tunneling design and security model
- Desktop app integration documentation
- On-chain registration scripts

---

## 8) Open questions

- Final source-of-truth for schema registry (Gateway vs chain) in V1 roll-out.
- Whether builders require a full `/registry` endpoint or only scoped `/v1/data` reads.
