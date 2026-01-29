# Phase 2: Auth + Builder Read Path — Atomic Implementation Plan

## Goal
Deliver authenticated builder access to user data: Web3Signed authorization parsing, builder verification via Gateway, grant enforcement (local checks + remote revocation), scope wildcard matching, three read endpoints (`GET /v1/data/{scope}`, `GET /v1/data`, `GET /v1/data/{scope}/versions`), and access logging (JSON lines, daily rotation).

**Prerequisite:** Phase 1 complete (all tasks marked `[x]` in `docs/260128-phase-1-implementation-plan.md`)
**Source of truth:** `docs/260127-personal-server-scaffold.md` (Phase 2, sections 4.1-4.5)
**Vana protocol spec:** `docs/260121-data-portability-protocol-spec.md` (sections 4.1.9, 5.3, 5.4, 8.2)

---

## Dependency Graph

```
Layer 0 (all parallel, no deps beyond Phase 1):
  0.1  Add viem dependency to core + new export subpaths
  0.2  Scope wildcard matching + scopes barrel export
  0.3  Grant types + EIP-712 domain/types constants
  0.4  Access log writer (core/src/logging/access-log.ts)
  0.5  IndexManager: add listDistinctScopes, findClosestByScope, findByFileId
  0.6  Test utilities: wallet fixtures (core/src/test-utils/)

Layer 1 (after Layer 0):
  1.1  Web3Signed parse + verify (core/src/auth/)         (after 0.1, 0.6)
  1.2  Grant verify (core/src/grants/verify.ts)            (after 0.1, 0.2, 0.3)
  1.3  GatewayClient stub (core/src/gateway/client.ts)     (after 0.1, 0.3)

Layer 2 (after Layer 1):
  2.1  web3-auth middleware                                (after 1.1)
  2.2  builder-check middleware                            (after 1.3)
  2.3  grant-check middleware                              (after 1.2, 1.3)
  2.4  access-log middleware                               (after 0.4)

Layer 3 (after Layer 2):
  3.1  GET /v1/data/:scope route                           (after 2.1-2.4, 0.5)
  3.2  GET /v1/data route (list scopes)                    (after 2.1, 2.2, 0.5)
  3.3  GET /v1/data/:scope/versions route                  (after 2.1, 2.2, 0.5)

Layer 4 (after Layer 3):
  4.1  Update app.ts, bootstrap.ts, config schema, exports (after 3.1-3.3)

Layer 5 (final):
  5.1  npm install + build + test + verify
```

**Critical path:** 0.1 → 1.1 → 2.1 → 3.1 → 4.1 → 5.1

---

## Tasks

### Layer 0: Foundation (all parallel)

#### Task 0.1: Add viem dependency + new export subpaths
- **Status:** `[x]`
- **Files:** `packages/core/package.json`
- **Deps:** Phase 1 complete
- **Spec:**
  Add to `dependencies`:
  ```json
  "viem": "^2.23.0"
  ```
  Add new export subpaths (matching existing format):
  ```json
  "./auth": {
    "types": "./dist/auth/web3-signed.d.ts",
    "import": "./dist/auth/web3-signed.js"
  },
  "./grants": {
    "types": "./dist/grants/index.d.ts",
    "import": "./dist/grants/index.js"
  },
  "./gateway": {
    "types": "./dist/gateway/client.d.ts",
    "import": "./dist/gateway/client.js"
  },
  "./logging/access-log": {
    "types": "./dist/logging/access-log.d.ts",
    "import": "./dist/logging/access-log.js"
  },
  "./test-utils": {
    "types": "./dist/test-utils/index.d.ts",
    "import": "./dist/test-utils/index.js"
  }
  ```
- **Done when:** `viem` in deps, all 5 new export paths defined
- **Verify:** `cat packages/core/package.json | grep viem`

---

#### Task 0.2: Scope wildcard matching + scopes barrel
- **Status:** `[x]`
- **Files:** `packages/core/src/scopes/match.ts`, `packages/core/src/scopes/match.test.ts`, `packages/core/src/scopes/index.ts` (new barrel)
- **Deps:** Phase 1 complete
- **Spec:**

  `match.ts`:
  ```typescript
  /**
   * Check if a requested concrete scope is covered by a single grant scope pattern.
   * Patterns:
   *   "*"                -> matches any scope
   *   "instagram.*"      -> matches any scope starting with "instagram."
   *   "instagram.profile" -> exact match only
   */
  export function scopeMatchesPattern(requestedScope: string, grantPattern: string): boolean

  /**
   * Check if a requested scope is covered by ANY of the granted scope patterns.
   */
  export function scopeCoveredByGrant(requestedScope: string, grantedScopes: string[]): boolean
  ```

  `index.ts` (barrel re-exporting from `parse.ts` + `match.ts`):
  ```typescript
  export { ScopeSchema, parseScope, scopeToPathSegments, type Scope, type ParsedScope } from './parse.js'
  export { scopeMatchesPattern, scopeCoveredByGrant } from './match.js'
  ```

  Update `packages/core/package.json` `"./scopes"` export to point at `./dist/scopes/index.d.ts` / `./dist/scopes/index.js`.

- **Tests (10 cases):**
  1. `scopeMatchesPattern("instagram.profile", "instagram.profile")` → `true` (exact)
  2. `scopeMatchesPattern("instagram.profile", "instagram.*")` → `true` (wildcard)
  3. `scopeMatchesPattern("instagram.profile", "*")` → `true` (global wildcard)
  4. `scopeMatchesPattern("instagram.profile", "twitter.*")` → `false`
  5. `scopeMatchesPattern("instagram.profile", "instagram.likes")` → `false`
  6. `scopeMatchesPattern("chatgpt.conversations.shared", "chatgpt.*")` → `true` (3-segment)
  7. `scopeMatchesPattern("instagram.profile", "instagram.profile.detail")` → `false`
  8. `scopeCoveredByGrant("instagram.profile", ["twitter.*", "instagram.*"])` → `true`
  9. `scopeCoveredByGrant("instagram.profile", ["twitter.*", "facebook.*"])` → `false`
  10. `scopeCoveredByGrant("instagram.profile", [])` → `false`
- **Verify:** `npx vitest run packages/core/src/scopes/match`

---

#### Task 0.3: Grant types + EIP-712 domain/types constants
- **Status:** `[x]`
- **Files:** `packages/core/src/grants/types.ts`, `packages/core/src/grants/eip712.ts`, `packages/core/src/grants/eip712.test.ts`
- **Deps:** Phase 1 complete
- **Spec:**

  `types.ts`:
  ```typescript
  export interface GrantPayload {
    user: `0x${string}`
    builder: `0x${string}`
    scopes: string[]
    expiresAt: bigint
    nonce: bigint
  }

  export interface GrantWithSignature {
    grantId: string
    payload: GrantPayload
    signature: `0x${string}`
  }

  /** Gateway response for GET /v1/grants/{grantId} */
  export interface GatewayGrantResponse {
    grantId: string
    user: string
    builder: string
    scopes: string[]
    expiresAt: number
    revoked: boolean
  }
  ```

  `eip712.ts`:
  ```typescript
  import type { TypedDataDomain } from 'viem'

  export const GRANT_DOMAIN: TypedDataDomain = {
    name: 'Vana Data Portability',
    version: '1',
    chainId: 14800,
    verifyingContract: '0x...' as `0x${string}`, // placeholder — fill from deployed contract
  } as const

  export const GRANT_TYPES = {
    Grant: [
      { name: 'user', type: 'address' },
      { name: 'builder', type: 'address' },
      { name: 'scopes', type: 'string[]' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
  } as const

  export function grantToEip712Message(payload: GrantPayload): Record<string, unknown>
  ```

- **Tests (3 cases):**
  1. `GRANT_DOMAIN.name === "Vana Data Portability"` and `chainId === 14800`
  2. `GRANT_TYPES.Grant` has 5 fields in correct order
  3. `grantToEip712Message(...)` returns object with all grant fields
- **Verify:** `npx vitest run packages/core/src/grants/eip712`

---

#### Task 0.4: Access log writer
- **Status:** `[x]`
- **Files:** `packages/core/src/logging/access-log.ts`, `packages/core/src/logging/access-log.test.ts`
- **Deps:** Phase 1 complete
- **Spec:**

  ```typescript
  export interface AccessLogEntry {
    logId: string            // crypto.randomUUID()
    grantId: string
    builder: string
    action: 'read'
    scope: string
    timestamp: string        // ISO 8601
    ipAddress: string
    userAgent: string
  }

  export interface AccessLogWriter {
    write(entry: AccessLogEntry): Promise<void>
  }

  /** Appends JSON line to {logsDir}/access-{YYYY-MM-DD}.log */
  export function createAccessLogWriter(logsDir: string): AccessLogWriter
  ```

  Implementation: `mkdir(logsDir, { recursive: true })`, then `appendFile(path, JSON.stringify(entry) + '\n')`.

- **Tests (5 cases)** using temp directory:
  1. `write()` creates log file in correct directory
  2. Log file name follows `access-{YYYY-MM-DD}.log` pattern
  3. File content is valid JSON line (parseable)
  4. Two writes same day → same file, 2 lines
  5. Writes to different days → separate files
- **Verify:** `npx vitest run packages/core/src/logging/access-log`

---

#### Task 0.5: IndexManager — add listDistinctScopes + findClosestByScope + findByFileId
- **Status:** `[x]`
- **Files:** `packages/core/src/storage/index/manager.ts` (modify), `packages/core/src/storage/index/manager.test.ts` (modify), `packages/core/src/storage/index/types.ts` (modify)
- **Deps:** Phase 1 complete
- **Spec:**

  Add to `IndexManager` interface:
  ```typescript
  listDistinctScopes(options?: {
    scopePrefix?: string
    limit?: number
    offset?: number
  }): { scopes: ScopeSummary[]; total: number }

  findClosestByScope(scope: string, at: string): IndexEntry | undefined

  findByFileId(fileId: string): IndexEntry | undefined
  ```

  Add to `types.ts`:
  ```typescript
  export interface ScopeSummary {
    scope: string
    latestCollectedAt: string
    versionCount: number
  }
  ```

  SQL for `listDistinctScopes`:
  ```sql
  SELECT scope, MAX(collected_at) as latest_collected_at, COUNT(*) as version_count
  FROM data_files
  WHERE scope LIKE @prefix  -- "instagram%" if scopePrefix provided
  GROUP BY scope ORDER BY scope ASC
  LIMIT @limit OFFSET @offset
  ```

  SQL for `findClosestByScope`:
  ```sql
  SELECT * FROM data_files WHERE scope = @scope AND collected_at <= @at
  ORDER BY collected_at DESC LIMIT 1
  ```

- **Tests (7 new cases):**
  1. `listDistinctScopes()` empty when no data
  2. Returns correct scope, latestCollectedAt, versionCount
  3. `scopePrefix` filter works
  4. `limit` pagination works
  5. `findClosestByScope` returns entry at or before given time
  6. `findClosestByScope` returns `undefined` when no entry at/before time
  7. `findByFileId` returns correct entry or undefined
- **Verify:** `npx vitest run packages/core/src/storage/index/manager`

---

#### Task 0.6: Test utilities — wallet fixtures
- **Status:** `[x]`
- **Files:** `packages/core/src/test-utils/wallet.ts`, `packages/core/src/test-utils/wallet.test.ts`, `packages/core/src/test-utils/index.ts`
- **Deps:** 0.1 (needs viem)
- **Spec:**

  ```typescript
  export interface TestWallet {
    address: `0x${string}`
    privateKey: `0x${string}`
    signMessage(message: string): Promise<`0x${string}`>
    signTypedData(params: {
      domain: Record<string, unknown>
      types: Record<string, Array<{ name: string; type: string }>>
      primaryType: string
      message: Record<string, unknown>
    }): Promise<`0x${string}`>
  }

  /** Deterministic test wallet from seed index */
  export function createTestWallet(seed?: number): TestWallet

  /** Build a valid Web3Signed Authorization header value */
  export async function buildWeb3SignedHeader(params: {
    wallet: TestWallet
    aud: string
    method: string
    uri: string
    bodyHash?: string
    iat?: number
    exp?: number
    grantId?: string
  }): Promise<string>
  ```

  Implementation uses viem's `privateKeyToAccount`. `buildWeb3SignedHeader` creates payload JSON with sorted keys, base64url encodes, signs via EIP-191, returns `"Web3Signed {base64url}.{signature}"`.

- **Tests (4 cases):**
  1. `createTestWallet(0)` returns valid Ethereum address
  2. `createTestWallet(0)` is deterministic
  3. `buildWeb3SignedHeader(...)` returns string starting with `"Web3Signed "`
  4. Header has exactly one dot between payload and signature
- **Verify:** `npx vitest run packages/core/src/test-utils/wallet`

---

### Layer 1: Auth + Grant + Gateway

#### Task 1.1: Web3Signed parse + verify
- **Status:** `[x]`
- **Files:** `packages/core/src/auth/web3-signed.ts`, `packages/core/src/auth/web3-signed.test.ts`
- **Deps:** 0.1, 0.6
- **Spec:**

  ```typescript
  export interface Web3SignedPayload {
    aud: string
    method: string
    uri: string
    bodyHash: string
    iat: number
    exp: number
    grantId?: string
  }

  export interface VerifiedAuth {
    signer: `0x${string}`
    payload: Web3SignedPayload
  }

  /** Parse "Web3Signed <base64url>.<signature>" header */
  export function parseWeb3SignedHeader(headerValue: string | undefined): {
    payloadBase64: string
    payload: Web3SignedPayload
    signature: `0x${string}`
  }

  /** Full verification: recover signer, check aud/method/uri/timing */
  export async function verifyWeb3Signed(params: {
    headerValue: string | undefined
    expectedOrigin: string
    expectedMethod: string
    expectedPath: string
    now?: number
  }): Promise<VerifiedAuth>
  ```

  Verification steps:
  1. Parse header → base64url + signature
  2. Recover signer via `verifyMessage` (EIP-191) over the base64url string
  3. Check `aud === expectedOrigin`, `method === expectedMethod`, `uri === expectedPath`
  4. Check `iat`/`exp` within 300s skew
  5. Return `{ signer, payload }`

- **Tests (12 cases):**
  1. `parseWeb3SignedHeader(undefined)` → MissingAuthError
  2. `parseWeb3SignedHeader("")` → MissingAuthError
  3. `parseWeb3SignedHeader("Bearer xyz")` → InvalidSignatureError
  4. `parseWeb3SignedHeader("Web3Signed malformed")` → InvalidSignatureError (no dot)
  5. `parseWeb3SignedHeader(validHeader)` → correct payload
  6. `verifyWeb3Signed` with valid header → correct signer
  7. Mismatched `aud` → InvalidSignatureError
  8. Mismatched `method` → InvalidSignatureError
  9. Mismatched `uri` → InvalidSignatureError
  10. Expired token → ExpiredTokenError
  11. Future `iat` beyond skew → ExpiredTokenError
  12. grantId in payload preserved in result
- **Verify:** `npx vitest run packages/core/src/auth/web3-signed`

---

#### Task 1.2: Grant verification (local)
- **Status:** `[x]`
- **Files:** `packages/core/src/grants/verify.ts`, `packages/core/src/grants/verify.test.ts`, `packages/core/src/grants/index.ts`
- **Deps:** 0.1, 0.2, 0.3
- **Spec:**

  ```typescript
  export interface GrantVerificationResult {
    valid: true
    grant: GrantPayload
  }

  /**
   * Local-only grant verification (no network):
   * 1. Recover signer from EIP-712 signature, verify === expectedOwner
   * 2. Check expiresAt (0 = no expiry, else > now)
   * 3. Check requestedScope ⊆ grantedScopes
   * 4. Check requestSigner === grant.builder
   */
  export async function verifyGrantLocal(params: {
    grant: GrantWithSignature
    expectedOwner: `0x${string}`
    requestSigner: `0x${string}`
    requestedScope: string
    now?: number
  }): Promise<GrantVerificationResult>
  ```

  `index.ts` barrel re-exports types, eip712, verify.

- **Tests (9 cases):**
  1. Valid grant → `{ valid: true, grant }`
  2. Wrong signer → InvalidSignatureError
  3. Expired → GrantExpiredError
  4. `expiresAt = 0n` (no expiry) → passes
  5. Scope not covered → ScopeMismatchError
  6. Scope covered by wildcard → passes
  7. Request signer ≠ grant.builder → InvalidSignatureError
  8. Tampered payload → InvalidSignatureError
  9. Multiple scopes, one matches → passes
- **Verify:** `npx vitest run packages/core/src/grants/verify`

---

#### Task 1.3: GatewayClient stub
- **Status:** `[ ]`
- **Files:** `packages/core/src/gateway/client.ts`, `packages/core/src/gateway/client.test.ts`
- **Deps:** 0.1, 0.3
- **Spec:**

  ```typescript
  export interface Builder {
    address: string
    name: string
    registered: boolean
  }

  export interface GatewayClient {
    isRegisteredBuilder(address: string): Promise<boolean>
    getBuilder(address: string): Promise<Builder | null>
    getGrant(grantId: string): Promise<GatewayGrantResponse | null>
  }

  export function createGatewayClient(baseUrl: string): GatewayClient
  ```

  Uses `fetch()`. 200 = found, 404 = null, network error = throw.

- **Tests (6 cases)** using mocked `fetch`:
  1. `isRegisteredBuilder` → `true` on 200
  2. `isRegisteredBuilder` → `false` on 404
  3. `isRegisteredBuilder` throws on network error
  4. `getGrant` returns parsed response on 200
  5. `getGrant` returns `null` on 404
  6. `getGrant` throws on network error
- **Verify:** `npx vitest run packages/core/src/gateway/client`

---

### Layer 2: Server Middleware

#### Task 2.1: Web3Auth middleware
- **Status:** `[ ]`
- **Files:** `packages/server/src/middleware/web3-auth.ts`, `packages/server/src/middleware/web3-auth.test.ts`
- **Deps:** 1.1
- **Spec:**

  ```typescript
  /** Parses + verifies Web3Signed Authorization header.
   *  Sets c.set('auth', VerifiedAuth) for downstream handlers. */
  export function createWeb3AuthMiddleware(serverOrigin: string): MiddlewareHandler
  ```

- **Tests (5 cases):**
  1. Valid header → sets auth, calls next
  2. Missing header → 401 MISSING_AUTH
  3. Invalid signature → 401 INVALID_SIGNATURE
  4. Expired → 401 EXPIRED_TOKEN
  5. Signer accessible downstream via `c.get('auth')`
- **Verify:** `npx vitest run packages/server/src/middleware/web3-auth`

---

#### Task 2.2: Builder check middleware
- **Status:** `[ ]`
- **Files:** `packages/server/src/middleware/builder-check.ts`, `packages/server/src/middleware/builder-check.test.ts`
- **Deps:** 1.3
- **Spec:**

  ```typescript
  /** Verifies authenticated signer is a registered builder via Gateway.
   *  Must run AFTER web3-auth middleware. */
  export function createBuilderCheckMiddleware(gateway: GatewayClient): MiddlewareHandler
  ```

- **Tests (3 cases):**
  1. Registered builder → calls next
  2. Unregistered → 401 UNREGISTERED_BUILDER
  3. Gateway error → 500
- **Verify:** `npx vitest run packages/server/src/middleware/builder-check`

---

#### Task 2.3: Grant check middleware
- **Status:** `[ ]`
- **Files:** `packages/server/src/middleware/grant-check.ts`, `packages/server/src/middleware/grant-check.test.ts`
- **Deps:** 1.2, 1.3
- **Spec:**

  ```typescript
  /** Enforces grant for data reads. Must run AFTER web3-auth middleware.
   *  Fetches grant from Gateway, checks revocation/expiry/scope/grantee.
   *  Sets c.set('grant', grantResponse). */
  export function createGrantCheckMiddleware(params: {
    gateway: GatewayClient
    serverOwner: `0x${string}`
  }): MiddlewareHandler
  ```

  Flow:
  1. Extract `grantId` from `auth.payload.grantId` → GrantRequiredError if missing
  2. `gateway.getGrant(grantId)` → GrantRequiredError if null
  3. `grant.revoked` → GrantRevokedError
  4. Expiry check (`expiresAt > 0 && expiresAt < now`) → GrantExpiredError
  5. Scope check via `scopeCoveredByGrant(scope, grant.scopes)` → ScopeMismatchError
  6. Grantee check (`auth.signer === grant.builder`) → InvalidSignatureError
  7. Set `c.set('grant', grant)`, call `next()`

- **Tests (8 cases):**
  1. Valid grant → next, grant on context
  2. Missing grantId → 403 GRANT_REQUIRED
  3. Grant not found → 403 GRANT_REQUIRED
  4. Revoked → 403 GRANT_REVOKED
  5. Expired → 403 GRANT_EXPIRED
  6. Scope mismatch → 403 SCOPE_MISMATCH
  7. Grantee mismatch → 401 INVALID_SIGNATURE
  8. `expiresAt=0` (no expiry) → passes
- **Verify:** `npx vitest run packages/server/src/middleware/grant-check`

---

#### Task 2.4: Access log middleware
- **Status:** `[ ]`
- **Files:** `packages/server/src/middleware/access-log.ts`, `packages/server/src/middleware/access-log.test.ts`
- **Deps:** 0.4
- **Spec:**

  ```typescript
  /** Logs builder data access AFTER successful response (2xx).
   *  Fire-and-forget: write failures don't affect response. */
  export function createAccessLogMiddleware(writer: AccessLogWriter): MiddlewareHandler
  ```

  Runs `await next()` first, then on 2xx writes entry with `crypto.randomUUID()`, reads auth/grant from context.

- **Tests (4 cases):**
  1. 200 response → entry written with correct fields
  2. 401 response → no entry written
  3. Missing user-agent → `'unknown'`
  4. Writer failure → response unaffected
- **Verify:** `npx vitest run packages/server/src/middleware/access-log`

---

### Layer 3: Read Endpoints

#### Task 3.1: GET /v1/data/:scope (read data file)
- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/data.ts` (modify), `packages/server/src/routes/data.test.ts` (modify)
- **Deps:** 2.1-2.4, 0.5
- **Spec:**

  Add GET handler to existing `dataRoutes`:
  ```typescript
  app.get('/:scope', web3Auth, builderCheck, grantCheck, accessLog, async (c) => {
    // 1. Validate scope
    // 2. Check query: fileId or at or default (latest)
    // 3. Lookup via indexManager.findByFileId / findClosestByScope / findLatestByScope
    // 4. 404 if not found
    // 5. readDataFile(hierarchyOptions, scope, entry.collectedAt)
    // 6. Return 200 with envelope JSON
  })
  ```

  Update `DataRouteDeps`:
  ```typescript
  export interface DataRouteDeps {
    indexManager: IndexManager
    hierarchyOptions: HierarchyManagerOptions
    logger: Logger
    serverOrigin: string
    serverOwner: `0x${string}`
    gateway: GatewayClient
    accessLogWriter: AccessLogWriter
  }
  ```

  Middleware instances created inside `dataRoutes()` from deps.

- **Tests (8 new cases):**
  1. Valid auth + grant → 200 with DataFileEnvelope
  2. No auth → 401 MISSING_AUTH
  3. Unregistered builder → 401 UNREGISTERED_BUILDER
  4. No grantId → 403 GRANT_REQUIRED
  5. Expired grant → 403 GRANT_EXPIRED
  6. Scope mismatch → 403 SCOPE_MISMATCH
  7. Nonexistent scope → 404
  8. `at` query param → correct version
- **Verify:** `npx vitest run packages/server/src/routes/data`

---

#### Task 3.2: GET /v1/data (list scopes)
- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/data.ts` (modify), `packages/server/src/routes/data.test.ts` (modify)
- **Deps:** 2.1, 2.2, 0.5
- **Spec:**

  Builder auth required, NO grant required:
  ```typescript
  app.get('/', web3Auth, builderCheck, async (c) => {
    const { scopePrefix, limit, offset } = // parse query params
    const result = deps.indexManager.listDistinctScopes({ scopePrefix, limit, offset })
    return c.json({ scopes: result.scopes, total: result.total, limit, offset })
  })
  ```

- **Tests (5 new cases):**
  1. Valid auth → 200 with scopes array
  2. `scopePrefix` filter works
  3. `limit`/`offset` pagination works
  4. No auth → 401
  5. Unregistered builder → 401
- **Verify:** `npx vitest run packages/server/src/routes/data`

---

#### Task 3.3: GET /v1/data/:scope/versions
- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/data.ts` (modify), `packages/server/src/routes/data.test.ts` (modify)
- **Deps:** 2.1, 2.2, 0.5
- **Spec:**

  Builder auth required, NO grant required:
  ```typescript
  app.get('/:scope/versions', web3Auth, builderCheck, async (c) => {
    // Validate scope, parse limit/offset
    const entries = deps.indexManager.findByScope({ scope, limit, offset })
    const total = deps.indexManager.countByScope(scope)
    return c.json({
      scope,
      versions: entries.map(e => ({ fileId: e.fileId, collectedAt: e.collectedAt })),
      total, limit, offset,
    })
  })
  ```

- **Tests (5 new cases):**
  1. Valid auth → 200 with versions array
  2. Ordered by collectedAt DESC
  3. Pagination works
  4. Invalid scope → 400
  5. No auth → 401
- **Verify:** `npx vitest run packages/server/src/routes/data`

---

### Layer 4: Integration

#### Task 4.1: Update app.ts, bootstrap.ts, config schema
- **Status:** `[ ]`
- **Files:** `packages/server/src/app.ts`, `packages/server/src/bootstrap.ts`, `packages/server/src/app.test.ts`, `packages/server/src/bootstrap.test.ts`, `packages/core/src/schemas/server-config.ts`
- **Deps:** 3.1-3.3
- **Spec:**

  **server-config.ts**: Add `server.origin` (optional URL string):
  ```typescript
  server: z.object({
    port: z.number().int().min(1).max(65535).default(8080),
    address: z.string().optional(),
    origin: z.string().url().optional(),
  }).default({})
  ```
  Note: `server.address` already exists and serves as the owner wallet address.

  **bootstrap.ts**:
  - Create `gatewayClient = createGatewayClient(config.gatewayUrl)`
  - Create `accessLogWriter = createAccessLogWriter(join(configDir, 'logs'))`
  - Derive `serverOrigin = config.server.origin ?? \`http://localhost:${config.server.port}\``
  - Derive `serverOwner` from `config.server.address` (cast to `0x${string}`)
  - Pass new deps to `createApp()`
  - Add `gatewayClient` to `ServerContext`

  **app.ts**: Update `AppDeps` to include `serverOrigin`, `serverOwner`, `gateway`, `accessLogWriter`. Pass through to `dataRoutes()`.

- **Tests (6 new cases):**
  1. `createServer` returns context with `gatewayClient`
  2. GET /v1/data returns 401 (middleware wired)
  3. GET /v1/data/:scope returns 401 (middleware wired)
  4. GET /v1/data/:scope/versions returns 401 (middleware wired)
  5. POST /v1/data/:scope still works without auth (Phase 1 preserved)
  6. Config schema accepts `server.origin`
- **Verify:** `npx vitest run packages/server/src/app && npx vitest run packages/server/src/bootstrap`

---

### Layer 5: Final Verification

#### Task 5.1: Install, build, test
- **Status:** `[ ]`
- **Deps:** all previous
- **Steps:**
  1. `npm install` — viem installed
  2. `npm run build` — all 3 packages compile
  3. `npm test` — all tests pass (Phase 0 + 1 + 2)
  4. Verify new exports resolve: `node -e "import('@personal-server/core/auth')"`
  5. Verify: `node -e "import('@personal-server/core/grants')"`
  6. Verify: `node -e "import('@personal-server/core/gateway')"`

---

## File Inventory (31 file operations)

| Task | File | New/Modified |
|------|------|-------------|
| 0.1 | `packages/core/package.json` | Modified |
| 0.2 | `packages/core/src/scopes/match.ts` | New |
| 0.2 | `packages/core/src/scopes/match.test.ts` | New |
| 0.2 | `packages/core/src/scopes/index.ts` | New |
| 0.3 | `packages/core/src/grants/types.ts` | New |
| 0.3 | `packages/core/src/grants/eip712.ts` | New |
| 0.3 | `packages/core/src/grants/eip712.test.ts` | New |
| 0.4 | `packages/core/src/logging/access-log.ts` | New |
| 0.4 | `packages/core/src/logging/access-log.test.ts` | New |
| 0.5 | `packages/core/src/storage/index/types.ts` | Modified |
| 0.5 | `packages/core/src/storage/index/manager.ts` | Modified |
| 0.5 | `packages/core/src/storage/index/manager.test.ts` | Modified |
| 0.6 | `packages/core/src/test-utils/wallet.ts` | New |
| 0.6 | `packages/core/src/test-utils/wallet.test.ts` | New |
| 0.6 | `packages/core/src/test-utils/index.ts` | New |
| 1.1 | `packages/core/src/auth/web3-signed.ts` | New |
| 1.1 | `packages/core/src/auth/web3-signed.test.ts` | New |
| 1.2 | `packages/core/src/grants/verify.ts` | New |
| 1.2 | `packages/core/src/grants/verify.test.ts` | New |
| 1.2 | `packages/core/src/grants/index.ts` | New |
| 1.3 | `packages/core/src/gateway/client.ts` | New |
| 1.3 | `packages/core/src/gateway/client.test.ts` | New |
| 2.1 | `packages/server/src/middleware/web3-auth.ts` | New |
| 2.1 | `packages/server/src/middleware/web3-auth.test.ts` | New |
| 2.2 | `packages/server/src/middleware/builder-check.ts` | New |
| 2.2 | `packages/server/src/middleware/builder-check.test.ts` | New |
| 2.3 | `packages/server/src/middleware/grant-check.ts` | New |
| 2.3 | `packages/server/src/middleware/grant-check.test.ts` | New |
| 2.4 | `packages/server/src/middleware/access-log.ts` | New |
| 2.4 | `packages/server/src/middleware/access-log.test.ts` | New |
| 3.1-3.3 | `packages/server/src/routes/data.ts` | Modified |
| 3.1-3.3 | `packages/server/src/routes/data.test.ts` | Modified |
| 4.1 | `packages/server/src/app.ts` | Modified |
| 4.1 | `packages/server/src/app.test.ts` | Modified |
| 4.1 | `packages/server/src/bootstrap.ts` | Modified |
| 4.1 | `packages/server/src/bootstrap.test.ts` | Modified |
| 4.1 | `packages/core/src/schemas/server-config.ts` | Modified |

**Total: 22 new files, 9 modified files**

---

## Agent Parallelism Strategy

| Batch | Tasks | Agents | Notes |
|-------|-------|--------|-------|
| 1 | 0.1, 0.2, 0.3, 0.4, 0.5 | 5 parallel | All independent; 0.6 waits for 0.1 |
| 2 | 0.6, 1.1, 1.2, 1.3 | 4 parallel | 0.6 after 0.1; 1.x after various 0.x |
| 3 | 2.1, 2.2, 2.3, 2.4 | 4 parallel | Each depends on different L1 tasks |
| 4 | 3.1, 3.2, 3.3 | 3 parallel | All need L2 middleware |
| 5 | 4.1 | 1 | Integration wiring |
| 6 | 5.1 | 1 | Verification only |

---

## Design Notes

- **viem over ethers** — tree-shakeable, TypeScript-first, direct `verifyMessage` (EIP-191) and `verifyTypedData` (EIP-712) functions.
- **POST /v1/data/:scope stays unauthenticated** — Phase 1 behavior preserved. Scaffold says localhost-only MAY skip auth on POST. Owner auth for POST deferred to Phase 3.
- **Grant check uses Gateway** — For Phase 2, the grant-check middleware fetches the full grant from Gateway (payload + revocation status) and performs local checks (expiry, scope, grantee) on the returned data. `verifyGrantLocal()` with full EIP-712 local-only verification is available but not used in the middleware yet — the middleware verifies using the gateway-provided payload fields.
- **Scopes barrel export** — Task 0.2 changes `./scopes` export from `parse.d.ts` to `index.d.ts`. Backward-compatible: barrel re-exports everything from `parse.ts`.
- **Access log is fire-and-forget** — Write errors logged via pino, never fail the request.
- **`server.address` reused as owner** — The existing `server.address` optional field in `ServerConfigSchema` serves as the owner wallet address. New `server.origin` field added for aud verification.
- **Hono context variables** — Middleware uses `c.set('auth', value)` / `c.get('auth')` without complex generics. Consumers cast.
- **`verifyingContract` placeholder** — EIP-712 domain has a TODO for the DataPortabilityPermissions contract address. Tests use any valid address.
- **Test wallet determinism** — `createTestWallet(seed)` derives deterministic private keys for reproducible tests.
