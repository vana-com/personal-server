# Phase 3: Owner Endpoints + Gateway Integration — Atomic Implementation Plan

## Goal
Deliver owner-only operations (delete, grants list, access logs), public grant verification, sync endpoint stubs, Gateway expansion (schemas, grants list, server lookup), schema-enforced data ingest, key derivation module, and access log reader. After Phase 3, the server supports the complete owner UX and is ready for the sync engine in Phase 4.

**Prerequisite:** Phase 2 complete (all tasks marked `[x]` in `docs/260128-phase-2-implementation-plan.md`)
**Source of truth:** `docs/260127-personal-server-scaffold.md` (Phase 3, sections 3-5)
**Vana protocol spec:** `docs/260121-data-portability-protocol-spec.md` (sections 4.1.5, 4.1.7-4.1.9, 4.2.4, 5.3, 5.4, 7.1, 8.2)

---

## Dependency Graph

```
Layer 0 (all parallel, no deps beyond Phase 2):
  0.1  Core package.json: add @noble/hashes + new export subpaths
  0.2  Key derivation (master key + scope keys) + tests
  0.3  Access log reader + tests

Layer 1 (after Layer 0):
  1.1  GatewayClient expansion (listGrantsByUser, getSchemaForScope, getServer) + tests
  1.2  Owner-check middleware + tests
  1.3  IndexManager: add deleteByScope() + tests

Layer 2 (after Layer 1):
  2.1  Hierarchy manager: deleteAllForScope() + tests        (after Phase 2 hierarchy)
  2.2  POST /v1/grants/verify route + tests                  (after Phase 2 grants)
  2.3  DataFileEnvelope: add optional $schema field + tests   (after Phase 2 schemas)

Layer 3 (after Layer 2):
  3.1  DELETE /v1/data/:scope route + tests                   (after 1.2, 1.3, 2.1)
  3.2  GET /v1/grants route + tests                           (after 1.1, 1.2)
  3.3  GET /v1/access-logs route + tests                      (after 0.3, 1.2)
  3.4  Sync stub routes + tests                               (after 1.2)
  3.5  POST /v1/data/:scope schema enforcement + tests        (after 1.1, 2.3)

Layer 4 (after Layer 3):
  4.1  Update app.ts + bootstrap.ts + config schema           (after all routes)

Layer 5 (final):
  5.1  npm install + build + test + verify
```

**Critical path:** 0.1 → 1.1 → 3.5 → 4.1 → 5.1

---

## Tasks

### Layer 0: Foundation (all parallel)

#### Task 0.1: Update core package.json
- **Status:** `[x]`
- **Files:** `packages/core/package.json`
- **Deps:** Phase 2 complete
- **Spec:**
  Add to `dependencies`:
  ```json
  "@noble/hashes": "^1.5.0"
  ```
  Add new export subpaths (matching existing format):
  ```json
  "./keys": {
    "types": "./dist/keys/index.d.ts",
    "import": "./dist/keys/index.js"
  },
  "./logging/access-reader": {
    "types": "./dist/logging/access-reader.d.ts",
    "import": "./dist/logging/access-reader.js"
  }
  ```
- **Done when:** `@noble/hashes` in deps, 2 new export paths defined
- **Verify:** `cat packages/core/package.json | grep noble`

---

#### Task 0.2: Key derivation (master + scope keys)
- **Status:** `[x]`
- **Files:** `packages/core/src/keys/derive.ts`, `packages/core/src/keys/derive.test.ts`, `packages/core/src/keys/index.ts`
- **Deps:** 0.1
- **Spec:**

  `derive.ts`:
  ```typescript
  import { hkdf } from '@noble/hashes/hkdf'
  import { sha256 } from '@noble/hashes/sha256'

  /**
   * Extracts master key material from EIP-191 signature over "vana-master-key-v1".
   * The raw signature bytes ARE the master key material (spec §2.3).
   * @param signature - 0x-prefixed hex string (65 bytes = 130 hex chars + 0x)
   * @returns 65-byte Uint8Array
   */
  export function deriveMasterKey(signature: `0x${string}`): Uint8Array

  /**
   * Derives a scope-specific 32-byte key via HKDF-SHA256.
   * salt = "vana", info = "scope:{scope}" (spec §2.3).
   */
  export function deriveScopeKey(masterKey: Uint8Array, scope: string): Uint8Array
  ```

  `index.ts` — barrel re-export.

- **Tests (6 cases):**
  1. `deriveMasterKey(validSig)` returns 65-byte Uint8Array
  2. `deriveMasterKey("0xinvalid")` throws (bad hex)
  3. `deriveMasterKey("0x" + "ab".repeat(30))` throws (wrong length)
  4. `deriveScopeKey(masterKey, "instagram.profile")` returns 32-byte Uint8Array
  5. Different scopes produce different keys
  6. Same inputs produce same output (deterministic)
- **Verify:** `npx vitest run packages/core/src/keys/`

---

#### Task 0.3: Access log reader
- **Status:** `[x]`
- **Files:** `packages/core/src/logging/access-reader.ts`, `packages/core/src/logging/access-reader.test.ts`
- **Deps:** Phase 2 (AccessLogEntry type exists in access-log.ts)
- **Spec:**

  ```typescript
  import type { AccessLogEntry } from './access-log.js'

  export interface AccessLogReadResult {
    logs: AccessLogEntry[]
    total: number
    limit: number
    offset: number
  }

  export interface AccessLogReader {
    read(options?: { limit?: number; offset?: number }): Promise<AccessLogReadResult>
  }

  /** Reads all access-*.log files, merges, sorts by timestamp DESC, paginates. */
  export function createAccessLogReader(logsDir: string): AccessLogReader
  ```

  Implementation:
  1. `readdir(logsDir)` — filter `access-*.log` files
  2. Read each file, split by newline, parse each line as JSON
  3. Skip malformed lines (log warning, continue)
  4. Merge all entries, sort by `timestamp` DESC
  5. Apply `offset` then `limit` (defaults: limit=50, offset=0)
  6. Return `{ logs, total, limit, offset }`
  7. If logsDir doesn't exist, return empty result

- **Tests (7 cases)** using temp directory:
  1. Empty/nonexistent logsDir → `{ logs: [], total: 0, limit: 50, offset: 0 }`
  2. Single file with 3 entries → returns all 3
  3. Two files (different dates) → entries merged correctly
  4. Sorted by timestamp DESC (newest first)
  5. `limit=2` returns first 2 entries
  6. `offset=2, limit=2` skips first 2, returns next 2
  7. Malformed JSON line skipped, other entries returned
- **Verify:** `npx vitest run packages/core/src/logging/access-reader`

---

### Layer 1: Gateway + Middleware + Index Extensions

#### Task 1.1: GatewayClient expansion
- **Status:** `[x]`
- **Files:** `packages/core/src/gateway/client.ts` (modify), `packages/core/src/gateway/client.test.ts` (modify)
- **Deps:** Phase 2 GatewayClient (client.ts exists with isRegisteredBuilder, getBuilder, getGrant)
- **Spec:**

  Add types:
  ```typescript
  export interface Schema {
    schemaId: string
    scope: string
    url: string          // IPFS CID URL for schema definition
  }

  export interface ServerInfo {
    address: string
    endpoint: string
    registered: boolean
    trusted: boolean
  }

  export interface GrantListItem {
    grantId: string
    builder: string
    scopes: string[]
    expiresAt: number
    createdAt: string
  }
  ```

  Add methods to `GatewayClient` interface:
  ```typescript
  listGrantsByUser(userAddress: string): Promise<GrantListItem[]>
  getSchemaForScope(scope: string): Promise<Schema | null>
  getServer(address: string): Promise<ServerInfo | null>
  ```

  Implementation pattern (same as Phase 2 methods): `fetch(url)` → 200 returns parsed JSON, 404 returns null/empty, other status throws.

  `listGrantsByUser`: `GET {base}/v1/grants?user={address}` → array (empty on 404)
  `getSchemaForScope`: `GET {base}/v1/schemas?scope={scope}` → Schema or null
  `getServer`: `GET {base}/v1/servers/{address}` → ServerInfo or null

- **Tests (6 new cases)** using mocked fetch:
  1. `listGrantsByUser` → returns grants array on 200
  2. `listGrantsByUser` → returns `[]` on 404
  3. `getSchemaForScope` → returns Schema on 200
  4. `getSchemaForScope` → returns `null` on 404
  5. `getServer` → returns ServerInfo on 200
  6. All throw on non-404 errors (500, 503)
- **Verify:** `npx vitest run packages/core/src/gateway/`

---

#### Task 1.2: Owner-check middleware
- **Status:** `[x]`
- **Files:** `packages/server/src/middleware/owner-check.ts`, `packages/server/src/middleware/owner-check.test.ts`
- **Deps:** Phase 2 (web3-auth middleware sets c.get('auth'))
- **Spec:**

  ```typescript
  import type { MiddlewareHandler } from 'hono'
  import { NotOwnerError } from '@personal-server/core/errors'

  /**
   * Verifies the authenticated signer is the server owner.
   * Must run AFTER web3-auth middleware (expects c.get('auth')).
   * Compares addresses case-insensitively.
   */
  export function createOwnerCheckMiddleware(
    serverOwner: `0x${string}`,
  ): MiddlewareHandler
  ```

  Implementation:
  1. Read `auth` from `c.get('auth')`
  2. Compare `auth.signer.toLowerCase() === serverOwner.toLowerCase()`
  3. If mismatch → throw `NotOwnerError({ signer, expected: serverOwner })`
  4. Otherwise → `await next()`

- **Tests (3 cases):**
  1. Signer === owner (case-insensitive) → calls next
  2. Signer !== owner → 401 NOT_OWNER
  3. Missing auth context → throws Error (programming error, not ProtocolError)
- **Verify:** `npx vitest run packages/server/src/middleware/owner-check`

---

#### Task 1.3: IndexManager — add deleteByScope()
- **Status:** `[ ]`
- **Files:** `packages/core/src/storage/index/manager.ts` (modify), `packages/core/src/storage/index/manager.test.ts` (modify)
- **Deps:** Phase 2 IndexManager
- **Spec:**

  Add to `IndexManager` interface:
  ```typescript
  /** Deletes all index entries for a scope. Returns count of deleted rows. */
  deleteByScope(scope: string): number
  ```

  Implementation:
  ```typescript
  const deleteByScopeStmt = db.prepare<{ scope: string }>(
    'DELETE FROM data_files WHERE scope = @scope',
  )

  deleteByScope(scope: string): number {
    const result = deleteByScopeStmt.run({ scope })
    return result.changes
  }
  ```

- **Tests (3 new cases):**
  1. Delete scope with 3 entries → returns 3
  2. Delete nonexistent scope → returns 0
  3. After delete, `findByScope({ scope })` returns empty
- **Verify:** `npx vitest run packages/core/src/storage/index/manager`

---

### Layer 2: Hierarchy Delete + Grant Verify + Schema Update

#### Task 2.1: Hierarchy manager — deleteAllForScope()
- **Status:** `[ ]`
- **Files:** `packages/core/src/storage/hierarchy/manager.ts` (modify), `packages/core/src/storage/hierarchy/manager.test.ts` (modify), `packages/core/src/storage/hierarchy/index.ts` (modify — re-export)
- **Deps:** Phase 2 hierarchy manager
- **Spec:**

  Add function:
  ```typescript
  import { rm } from 'node:fs/promises'
  import { buildScopeDir } from './paths.js'

  /**
   * Delete all files for a scope by removing the scope directory recursively.
   * No-op if directory doesn't exist.
   */
  export async function deleteAllForScope(
    options: HierarchyManagerOptions,
    scope: string,
  ): Promise<void> {
    const scopeDir = buildScopeDir(options.dataDir, scope)
    await rm(scopeDir, { recursive: true, force: true })
  }
  ```

  Add to `index.ts` barrel export.

- **Tests (4 cases):**
  1. Delete scope with 2 versions → files and directory removed
  2. After delete, `listVersions` returns `[]`
  3. Delete nonexistent scope → no error (idempotent)
  4. Delete scope with nested subcategory → entire subtree removed
- **Verify:** `npx vitest run packages/core/src/storage/hierarchy/`

---

#### Task 2.2: POST /v1/grants/verify route
- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/grants.ts` (new), `packages/server/src/routes/grants.test.ts` (new)
- **Deps:** Phase 2 (grants/verify.ts, grants/types.ts, eip712.ts)
- **Spec:**

  ```typescript
  import { Hono } from 'hono'
  import type { Logger } from 'pino'
  import type { GatewayClient } from '@personal-server/core/gateway'

  export interface GrantsRouteDeps {
    logger: Logger
    gateway: GatewayClient
    serverOwner: `0x${string}`
  }

  export function grantsRoutes(deps: GrantsRouteDeps): Hono
  ```

  `POST /verify` handler:
  - **Public endpoint** — no auth required
  - Accepts JSON body: `GrantWithSignature { grantId, payload: { user, builder, scopes, expiresAt, nonce }, signature }`
  - Validation: body must have grantId (string), payload (object with required fields), signature (0x string)
  - Verify EIP-712 signature via `verifyTypedData` (recover signer, check === payload.user)
  - Check expiry: `expiresAt > 0 && expiresAt < nowSeconds` → expired
  - Return 200: `{ valid: true, user, builder, scopes, expiresAt }` or `{ valid: false, error: "..." }`
  - Invalid body → 400

  Note: Does NOT check revocation (would require Gateway call; keep this endpoint simple and fast).

- **Tests (6 cases):**
  1. Valid grant + signature → `{ valid: true, user, builder, scopes, expiresAt }`
  2. Tampered payload (signature mismatch) → `{ valid: false, error: "..." }`
  3. Expired grant → `{ valid: false, error: "..." }`
  4. `expiresAt: 0` (no expiry) → `{ valid: true, ... }`
  5. Missing required fields → 400
  6. Invalid JSON body → 400
- **Verify:** `npx vitest run packages/server/src/routes/grants`

---

#### Task 2.3: DataFileEnvelope — add optional $schema field
- **Status:** `[ ]`
- **Files:** `packages/core/src/schemas/data-file.ts` (modify), `packages/core/src/schemas/data-file.test.ts` (modify)
- **Deps:** Phase 2 (DataFileEnvelopeSchema exists)
- **Spec:**

  Update schema:
  ```typescript
  export const DataFileEnvelopeSchema = z.object({
    $schema: z.string().url().optional(),   // NEW: schema URL from registry
    version: z.literal('1.0'),
    scope: z.string(),
    collectedAt: z.string().datetime(),
    data: z.record(z.unknown()),
  })
  ```

  Update `createDataFileEnvelope`:
  ```typescript
  export function createDataFileEnvelope(
    scope: string,
    collectedAt: string,
    data: Record<string, unknown>,
    schemaUrl?: string,               // NEW optional parameter
  ): DataFileEnvelope {
    return {
      ...(schemaUrl !== undefined && { $schema: schemaUrl }),
      version: '1.0',
      scope,
      collectedAt,
      data,
    }
  }
  ```

- **Tests (3 new cases):**
  1. `createDataFileEnvelope(scope, ts, data, "https://ipfs.io/...")` → envelope has `$schema`
  2. `createDataFileEnvelope(scope, ts, data)` → envelope has no `$schema` key
  3. `DataFileEnvelopeSchema.parse({ $schema: "https://...", version: "1.0", ... })` succeeds
- **Verify:** `npx vitest run packages/core/src/schemas/data-file`

---

### Layer 3: Routes

#### Task 3.1: DELETE /v1/data/:scope route
- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/data.ts` (modify), `packages/server/src/routes/data.test.ts` (modify)
- **Deps:** 1.2, 1.3, 2.1
- **Spec:**

  Add DELETE handler in `dataRoutes`:
  ```typescript
  app.delete('/:scope', async (c) => {
    // 1. Validate scope
    const scopeParam = c.req.param('scope')
    const scopeResult = ScopeSchema.safeParse(scopeParam)
    if (!scopeResult.success) {
      return c.json({ error: 'INVALID_SCOPE', message: ... }, 400)
    }
    const scope = scopeResult.data

    // 2. Delete from index
    const deletedCount = deps.indexManager.deleteByScope(scope)

    // 3. Delete from filesystem
    await deleteAllForScope(deps.hierarchyOptions, scope)

    deps.logger.info({ scope, deletedCount }, 'Scope deleted')

    // 4. Return 204
    return c.body(null, 204)
  })
  ```

  **Note:** Auth middleware (web3-auth + owner-check) wired in Task 4.1.

- **Tests (5 new cases):**
  1. DELETE existing scope (2 versions) → 204, files gone, index empty
  2. DELETE nonexistent scope → 204 (idempotent)
  3. DELETE invalid scope → 400
  4. After DELETE, GET same scope → 404 (no data found)
  5. DELETE then POST same scope → 201 (can re-create)
- **Verify:** `npx vitest run packages/server/src/routes/data`

---

#### Task 3.2: GET /v1/grants route
- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/grants.ts` (modify — add GET), `packages/server/src/routes/grants.test.ts` (modify)
- **Deps:** 1.1, 1.2
- **Spec:**

  Add `GET /` handler in `grantsRoutes`:
  ```typescript
  app.get('/', async (c) => {
    // Owner auth enforced by middleware (wired in Task 4.1)
    const grants = await deps.gateway.listGrantsByUser(deps.serverOwner)
    return c.json({ grants })
  })
  ```

  Response: `{ grants: [{ grantId, builder, scopes, expiresAt, createdAt }] }`

- **Tests (3 new cases):**
  1. Gateway returns 2 grants → `{ grants: [{...}, {...}] }`
  2. Gateway returns no grants → `{ grants: [] }`
  3. Gateway error → 500
- **Verify:** `npx vitest run packages/server/src/routes/grants`

---

#### Task 3.3: GET /v1/access-logs route
- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/access-logs.ts` (new), `packages/server/src/routes/access-logs.test.ts` (new)
- **Deps:** 0.3, 1.2
- **Spec:**

  ```typescript
  import { Hono } from 'hono'
  import type { AccessLogReader } from '@personal-server/core/logging/access-reader'
  import type { Logger } from 'pino'

  export interface AccessLogsRouteDeps {
    logger: Logger
    accessLogReader: AccessLogReader
  }

  export function accessLogsRoutes(deps: AccessLogsRouteDeps): Hono
  ```

  `GET /` handler:
  - Parse query params: `limit` (default 50), `offset` (default 0)
  - Call `deps.accessLogReader.read({ limit, offset })`
  - Return 200 JSON result

- **Tests (4 cases):**
  1. Returns `{ logs, total, limit: 50, offset: 0 }` shape
  2. `?limit=10&offset=5` → correct values in response
  3. No logs → `{ logs: [], total: 0, ... }`
  4. Non-numeric limit → defaults to 50
- **Verify:** `npx vitest run packages/server/src/routes/access-logs`

---

#### Task 3.4: Sync stub routes
- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/sync.ts` (new), `packages/server/src/routes/sync.test.ts` (new)
- **Deps:** 1.2
- **Spec:**

  ```typescript
  import { Hono } from 'hono'
  import type { Logger } from 'pino'

  export interface SyncRouteDeps {
    logger: Logger
  }

  export function syncRoutes(deps: SyncRouteDeps): Hono
  ```

  Three stub endpoints (owner auth wired in Task 4.1):

  `POST /trigger`:
  ```typescript
  app.post('/trigger', async (c) => {
    deps.logger.info('Sync trigger requested (stub)')
    return c.json({ status: 'started', message: 'Sync triggered' }, 202)
  })
  ```

  `GET /status`:
  ```typescript
  app.get('/status', async (c) => {
    return c.json({
      lastSync: null,
      lastProcessedTimestamp: null,
      pendingFiles: 0,
      errors: [],
    })
  })
  ```

  `POST /file/:fileId`:
  ```typescript
  app.post('/file/:fileId', async (c) => {
    const fileId = c.req.param('fileId')
    deps.logger.info({ fileId }, 'File sync requested (stub)')
    return c.json({ fileId, status: 'started' }, 202)
  })
  ```

- **Tests (3 cases):**
  1. POST /trigger → 202 `{ status: "started", message: "Sync triggered" }`
  2. GET /status → 200 `{ lastSync: null, pendingFiles: 0, ... }`
  3. POST /file/0x123 → 202 `{ fileId: "0x123", status: "started" }`
- **Verify:** `npx vitest run packages/server/src/routes/sync`

---

#### Task 3.5: POST /v1/data/:scope — schema enforcement
- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/data.ts` (modify POST handler), `packages/server/src/routes/data.test.ts` (modify)
- **Deps:** 1.1, 2.3
- **Spec:**

  Update `DataRouteDeps` (if not already updated by Phase 2 Task 4.1 — the gateway field should already be present):
  ```typescript
  export interface DataRouteDeps {
    indexManager: IndexManager
    hierarchyOptions: HierarchyManagerOptions
    logger: Logger
    // These should already exist from Phase 2 Task 4.1:
    serverOrigin: string
    serverOwner: `0x${string}`
    gateway: GatewayClient
    accessLogWriter: AccessLogWriter
  }
  ```

  Modify POST `/:scope` handler — add schema lookup before envelope creation:
  ```typescript
  // After scope validation, before generating collectedAt:

  // Look up schema via Gateway (STRICT: reject if not found)
  let schemaUrl: string | undefined
  try {
    const schema = await deps.gateway.getSchemaForScope(scope)
    if (!schema) {
      return c.json(
        { error: 'NO_SCHEMA', message: `No schema registered for scope: ${scope}` },
        400,
      )
    }
    schemaUrl = schema.url
  } catch (err) {
    deps.logger.error({ err, scope }, 'Gateway schema lookup failed')
    return c.json(
      { error: 'GATEWAY_ERROR', message: 'Failed to look up schema for scope' },
      502,
    )
  }

  // Then: generateCollectedAt, createDataFileEnvelope(scope, collectedAt, body, schemaUrl), ...
  ```

- **Tests (4 new cases):**
  1. Schema found → 201, envelope has `$schema` field
  2. Schema not found → 400 `{ error: "NO_SCHEMA", ... }`
  3. Gateway error → 502 `{ error: "GATEWAY_ERROR", ... }`
  4. Existing POST tests: mock gateway to return schema so they still pass
- **Verify:** `npx vitest run packages/server/src/routes/data`

---

### Layer 4: Integration

#### Task 4.1: Update app.ts + bootstrap.ts + config schema
- **Status:** `[ ]`
- **Files:** `packages/server/src/app.ts` (modify), `packages/server/src/bootstrap.ts` (modify), `packages/server/src/app.test.ts` (modify), `packages/server/src/bootstrap.test.ts` (modify), `packages/core/src/schemas/server-config.ts` (modify)
- **Deps:** All previous tasks
- **Spec:**

  **bootstrap.ts** additions:
  ```typescript
  import { createAccessLogReader } from '@personal-server/core/logging/access-reader'
  import type { AccessLogReader } from '@personal-server/core/logging/access-reader'

  export interface ServerContext {
    app: Hono
    logger: Logger
    config: ServerConfig
    startedAt: Date
    indexManager: IndexManager
    // Phase 2 already provides:
    // gatewayClient: GatewayClient
    // Phase 3 adds:
    accessLogReader: AccessLogReader
    cleanup: () => void
  }

  // In createServer():
  const logsDir = join(configDir, 'logs')
  const accessLogReader = createAccessLogReader(logsDir)

  // Pass accessLogReader to createApp() and return in context
  ```

  **app.ts** additions — mount new routes with auth middleware:
  ```typescript
  import { createOwnerCheckMiddleware } from './middleware/owner-check.js'
  import { grantsRoutes } from './routes/grants.js'
  import { accessLogsRoutes } from './routes/access-logs.js'
  import { syncRoutes } from './routes/sync.js'

  export interface AppDeps {
    // ... existing Phase 2 deps ...
    accessLogReader: AccessLogReader  // NEW
  }

  // In createApp():
  const ownerCheck = createOwnerCheckMiddleware(deps.serverOwner)
  const web3Auth = createWeb3AuthMiddleware(deps.serverOrigin)

  // Owner-auth middleware for DELETE /v1/data/:scope
  // (Applied per-route, not globally, since POST /v1/data/:scope has different auth)

  // Mount grants: POST /verify is public, GET / needs owner auth
  app.route('/v1/grants', grantsRoutes({
    logger: deps.logger,
    gateway: deps.gateway,
    serverOwner: deps.serverOwner,
  }))

  // Mount access-logs: all owner auth
  app.route('/v1/access-logs', accessLogsRoutes({
    logger: deps.logger,
    accessLogReader: deps.accessLogReader,
  }))

  // Mount sync: all owner auth
  app.route('/v1/sync', syncRoutes({ logger: deps.logger }))
  ```

  **Middleware wiring strategy for owner-only routes:**
  The owner-check middleware must be applied to:
  - `DELETE /v1/data/:scope`
  - `GET /v1/grants`
  - `GET /v1/access-logs`
  - All `/v1/sync/*`

  Options:
  - Apply middleware inside route factory functions (preferred for co-location)
  - Apply middleware at the app.ts mount level using Hono `use()`

  Choose the approach consistent with Phase 2's wiring of builder/grant middleware.

  **server-config.ts** — no changes needed (Phase 2 Task 4.1 already added `server.origin`; `server.address` serves as owner).

- **Tests (8 new/updated cases):**
  1. `ServerContext` has `accessLogReader` property
  2. DELETE /v1/data/:scope without auth → 401 MISSING_AUTH
  3. DELETE /v1/data/:scope with non-owner auth → 401 NOT_OWNER
  4. DELETE /v1/data/:scope with owner auth → 204
  5. GET /v1/grants without auth → 401
  6. GET /v1/access-logs without auth → 401
  7. POST /v1/sync/trigger without auth → 401
  8. POST /v1/grants/verify without auth → 200 (public)
- **Verify:** `npx vitest run packages/server/src/app && npx vitest run packages/server/src/bootstrap`

---

### Layer 5: Final Verification

#### Task 5.1: Install, build, test
- **Status:** `[ ]`
- **Deps:** all previous
- **Steps:**
  1. `npm install` — `@noble/hashes` installs
  2. `npm run build` — all 3 packages compile
  3. `npm test` — all tests pass (Phase 0 + 1 + 2 + 3)
  4. Verify new exports resolve: `node -e "import('@personal-server/core/keys')"`
  5. Verify: `node -e "import('@personal-server/core/logging/access-reader')"`
  6. Start server: `node packages/server/dist/index.js`
  7. Manual checks:
     - `curl -X POST .../v1/data/test.scope -d '{...}'` → 400 (no schema in mock gateway)
     - `curl -X DELETE .../v1/data/test.scope` → 401 (no auth)
     - `curl .../v1/grants` → 401 (no auth)
     - `curl .../v1/access-logs` → 401 (no auth)
     - `curl -X POST .../v1/sync/trigger` → 401 (no auth)
     - `curl -X POST .../v1/grants/verify -d '{...}'` → 200 (public, no auth needed)

---

## File Inventory (28 file operations)

| Task | File | New/Modified |
|------|------|-------------|
| 0.1 | `packages/core/package.json` | Modified |
| 0.2 | `packages/core/src/keys/derive.ts` | New |
| 0.2 | `packages/core/src/keys/derive.test.ts` | New |
| 0.2 | `packages/core/src/keys/index.ts` | New |
| 0.3 | `packages/core/src/logging/access-reader.ts` | New |
| 0.3 | `packages/core/src/logging/access-reader.test.ts` | New |
| 1.1 | `packages/core/src/gateway/client.ts` | Modified |
| 1.1 | `packages/core/src/gateway/client.test.ts` | Modified |
| 1.2 | `packages/server/src/middleware/owner-check.ts` | New |
| 1.2 | `packages/server/src/middleware/owner-check.test.ts` | New |
| 1.3 | `packages/core/src/storage/index/manager.ts` | Modified |
| 1.3 | `packages/core/src/storage/index/manager.test.ts` | Modified |
| 2.1 | `packages/core/src/storage/hierarchy/manager.ts` | Modified |
| 2.1 | `packages/core/src/storage/hierarchy/manager.test.ts` | Modified |
| 2.1 | `packages/core/src/storage/hierarchy/index.ts` | Modified |
| 2.2 | `packages/server/src/routes/grants.ts` | New |
| 2.2 | `packages/server/src/routes/grants.test.ts` | New |
| 2.3 | `packages/core/src/schemas/data-file.ts` | Modified |
| 2.3 | `packages/core/src/schemas/data-file.test.ts` | Modified |
| 3.1 | `packages/server/src/routes/data.ts` | Modified |
| 3.1 | `packages/server/src/routes/data.test.ts` | Modified |
| 3.2 | `packages/server/src/routes/grants.ts` | Modified |
| 3.2 | `packages/server/src/routes/grants.test.ts` | Modified |
| 3.3 | `packages/server/src/routes/access-logs.ts` | New |
| 3.3 | `packages/server/src/routes/access-logs.test.ts` | New |
| 3.4 | `packages/server/src/routes/sync.ts` | New |
| 3.4 | `packages/server/src/routes/sync.test.ts` | New |
| 3.5 | `packages/server/src/routes/data.ts` | Modified (same file as 3.1) |
| 3.5 | `packages/server/src/routes/data.test.ts` | Modified (same file as 3.1) |
| 4.1 | `packages/server/src/app.ts` | Modified |
| 4.1 | `packages/server/src/app.test.ts` | Modified |
| 4.1 | `packages/server/src/bootstrap.ts` | Modified |
| 4.1 | `packages/server/src/bootstrap.test.ts` | Modified |

**Unique files: 13 new, 12 modified = 25 distinct files**

---

## Agent Parallelism Strategy

| Batch | Tasks | Agents | Notes |
|-------|-------|--------|-------|
| 1 | 0.1, 0.2, 0.3 | 3 parallel | All independent |
| 2 | 1.1, 1.2, 1.3 | 3 parallel | Each extends a different Phase 2 module |
| 3 | 2.1, 2.2, 2.3 | 3 parallel | Independent modifications |
| 4 | 3.1, 3.2, 3.3, 3.4, 3.5 | 5 parallel | All routes, independent of each other |
| 5 | 4.1 | 1 | Integration wiring (touches shared files) |
| 6 | 5.1 | 1 | Verification only |

---

## Design Notes

- **Schema enforcement is strict** — `POST /v1/data/{scope}` rejects 400 if no schema found via Gateway. Matches protocol spec §4.1.5 step 2. Gateway errors return 502 (not 400).
- **POST /v1/grants/verify accepts full GrantWithSignature** — includes payload (user, builder, scopes, expiresAt, nonce) + signature. Enables local-only EIP-712 verification without Gateway. Does NOT check revocation (that requires Gateway; callers can check separately).
- **`server.address` is the owner** — Phase 2 already derives `serverOwner` from `config.server.address`. No new config field needed.
- **Phase 2 already wires gateway/origin/owner** — bootstrap.ts and app.ts already have gatewayClient, serverOrigin, serverOwner from Phase 2 Task 4.1. Phase 3 adds accessLogReader + new routes.
- **Sync endpoints are stubs** — return canned 202/200 responses. Phase 4 replaces with real sync engine. All require owner auth.
- **Key derivation uses `@noble/hashes`** — pure JS HKDF-SHA256, no Node crypto. Better portability across Tauri/Sprite/Docker.
- **Access log reader** — merges all `access-*.log` files, sorts by timestamp DESC, paginates. Skips malformed JSON lines silently. Returns empty result if logs dir doesn't exist.
- **DELETE /v1/data/:scope** — deletes ALL versions (index + filesystem). Idempotent: 204 even for nonexistent scope. No per-version delete in Phase 3.
- **Owner-check middleware** — case-insensitive address comparison. Must run AFTER web3-auth. Throws `NotOwnerError` (401).
- **DataFileEnvelope `$schema`** — optional field. Present when schema found via Gateway, absent otherwise. Phase 4 encryption will require it.
