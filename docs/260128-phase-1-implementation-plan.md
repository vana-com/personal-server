# Phase 1: Local Data Store + Ingest — Atomic Implementation Plan

## Goal
Deliver local data storage and ingest: filesystem hierarchy manager, SQLite registry index, and `POST /v1/data/{scope}` endpoint. Data is available to readers immediately after local write. No auth, no schema validation via Gateway, no encryption, no sync.

**Prerequisite:** Phase 0 complete (all tasks marked `[x]` in `docs/260128-phase-0-implementation-plan.md`)
**Source of truth:** `docs/260127-personal-server-scaffold.md` (Phase 1, sections 3-5)
**Vana protocol spec:** `docs/260121-data-portability-protocol-spec.md` (sections 4.1.5, 4.1.7, 4.1.8, 5.1, 5.2)

---

## Dependency Graph

```
Layer 0 (all parallel, no deps beyond Phase 0):
  0.1  Core package.json: add better-sqlite3 + new exports
  0.2  Scope parsing + validation + tests
  0.3  Data file Zod schema + tests

Layer 1 (after Layer 0):
  1.1  Hierarchy paths + timestamp utilities + tests  (after 0.2)
  1.2  SQLite index types + schema + tests            (after 0.1)

Layer 2 (after Layer 1):
  2.1  Hierarchy manager (write/read/list/delete) + tests  (after 1.1, 0.3)
  2.2  Index manager (CRUD on SQLite) + tests              (after 1.2)

Layer 3 (after Layer 2):
  3.1  Body size limit middleware + tests     (parallel, only needs Phase 0)
  3.2  POST /v1/data/{scope} route + tests   (after 2.1, 2.2, 0.3, 3.1)
  3.3  Update bootstrap.ts + app.ts          (after 3.2)

Layer 4 (final):
  4.1  npm install + build + test + verify
```

**Critical path:** 0.1 → 1.2 → 2.2 → 3.2 → 3.3 → 4.1

---

## Tasks

### Layer 0: Foundation (all parallel)

#### Task 0.1: Update core package.json
- **Status:** `[x]`
- **Files:** `packages/core/package.json`
- **Deps:** Phase 0 complete
- **Spec:**
  Add to `dependencies`:
  ```json
  "better-sqlite3": "^11.0.0"
  ```
  Add to `devDependencies`:
  ```json
  "@types/better-sqlite3": "^7.6.0"
  ```
  Add new export subpaths (matching existing format):
  ```json
  "./scopes": {
    "types": "./dist/scopes/parse.d.ts",
    "import": "./dist/scopes/parse.js"
  },
  "./storage/hierarchy": {
    "types": "./dist/storage/hierarchy/index.d.ts",
    "import": "./dist/storage/hierarchy/index.js"
  },
  "./storage/index": {
    "types": "./dist/storage/index/index.d.ts",
    "import": "./dist/storage/index/index.js"
  },
  "./schemas/data-file": {
    "types": "./dist/schemas/data-file.d.ts",
    "import": "./dist/schemas/data-file.js"
  }
  ```
- **Done when:** `package.json` has `better-sqlite3` in deps, `@types/better-sqlite3` in devDeps, all 4 new export paths defined

---

#### Task 0.2: Scope parsing + validation
- **Status:** `[x]`
- **Files:** `packages/core/src/scopes/parse.ts`, `packages/core/src/scopes/parse.test.ts`
- **Deps:** Phase 0 complete
- **Spec:**

  `parse.ts` — pure functions:
  ```typescript
  import { z } from 'zod'

  const SEGMENT_RE = /^[a-z][a-z0-9_]*$/

  export const ScopeSchema = z.string().refine(
    (s) => {
      const parts = s.split('.')
      return parts.length >= 2 && parts.length <= 3 && parts.every(p => SEGMENT_RE.test(p))
    },
    { message: 'Scope must be {source}.{category}[.{subcategory}] with lowercase alphanumeric segments' }
  )

  export type Scope = z.infer<typeof ScopeSchema>

  export interface ParsedScope {
    source: string
    category: string
    subcategory?: string
    raw: string
  }

  export function parseScope(scope: string): ParsedScope
  export function scopeToPathSegments(scope: string): string[]
  ```

- **Tests (8 cases):**
  1. `parseScope("instagram.profile")` → `{ source: "instagram", category: "profile", subcategory: undefined, raw: "instagram.profile" }`
  2. `parseScope("chatgpt.conversations.shared")` → subcategory `"shared"`
  3. `parseScope("youtube.watch_history")` succeeds (underscores allowed)
  4. `parseScope("a")` throws ZodError (1 segment)
  5. `parseScope("a.b.c.d")` throws ZodError (4 segments)
  6. `parseScope("Instagram.Profile")` throws ZodError (uppercase)
  7. `parseScope("123.abc")` throws ZodError (starts with digit)
  8. `scopeToPathSegments("chatgpt.conversations.shared")` → `["chatgpt", "conversations", "shared"]`
- **Verify:** `npx vitest run packages/core/src/scopes/`

---

#### Task 0.3: Data file Zod schema
- **Status:** `[x]`
- **Files:** `packages/core/src/schemas/data-file.ts`, `packages/core/src/schemas/data-file.test.ts`
- **Deps:** Phase 0 complete
- **Spec:**

  ```typescript
  import { z } from 'zod'

  export const DataFileEnvelopeSchema = z.object({
    version: z.literal('1.0'),
    scope: z.string(),
    collectedAt: z.string().datetime(),
    data: z.record(z.unknown()),
  })

  export type DataFileEnvelope = z.infer<typeof DataFileEnvelopeSchema>

  export function createDataFileEnvelope(
    scope: string,
    collectedAt: string,
    data: Record<string, unknown>,
  ): DataFileEnvelope

  export const IngestResponseSchema = z.object({
    scope: z.string(),
    collectedAt: z.string().datetime(),
    status: z.enum(['stored', 'syncing']),
  })

  export type IngestResponse = z.infer<typeof IngestResponseSchema>
  ```

- **Tests (5 cases):**
  1. `DataFileEnvelopeSchema.parse(valid)` succeeds
  2. `DataFileEnvelopeSchema.parse({ version: "2.0", ... })` fails
  3. `DataFileEnvelopeSchema.parse({ ..., collectedAt: "not-a-date" })` fails
  4. `createDataFileEnvelope(...)` returns correct envelope
  5. `IngestResponseSchema.parse(valid)` succeeds
- **Verify:** `npx vitest run packages/core/src/schemas/data-file`

---

### Layer 1: Paths + Index Schema

#### Task 1.1: Hierarchy paths + timestamp utilities
- **Status:** `[x]`
- **Files:** `packages/core/src/storage/hierarchy/paths.ts`, `packages/core/src/storage/hierarchy/paths.test.ts`
- **Deps:** 0.2
- **Spec:**

  ```typescript
  import { join } from 'node:path'
  import { scopeToPathSegments } from '../../scopes/parse.js'

  /** "2026-01-21T10:00:00Z" → "2026-01-21T10-00-00Z" */
  export function timestampToFilename(isoTimestamp: string): string

  /** "2026-01-21T10-00-00Z" → "2026-01-21T10:00:00Z" */
  export function filenameToTimestamp(filename: string): string

  /** Full file path: join(baseDir, ...scopeSegments, timestamp.json) */
  export function buildDataFilePath(baseDir: string, scope: string, collectedAt: string): string

  /** Directory path for a scope */
  export function buildScopeDir(baseDir: string, scope: string): string

  /** Generate current UTC timestamp without milliseconds, ending in Z */
  export function generateCollectedAt(): string
  ```

- **Tests (7 cases):**
  1. `timestampToFilename("2026-01-21T10:00:00Z")` → `"2026-01-21T10-00-00Z"`
  2. `filenameToTimestamp("2026-01-21T10-00-00Z")` → `"2026-01-21T10:00:00Z"`
  3. Roundtrip: `filenameToTimestamp(timestampToFilename(ts))` equals `ts`
  4. `buildDataFilePath("/data", "instagram.profile", "2026-01-21T10:00:00Z")` → `/data/instagram/profile/2026-01-21T10-00-00Z.json`
  5. `buildDataFilePath("/data", "chatgpt.conversations.shared", ...)` includes 3 directory segments
  6. `buildScopeDir("/data", "instagram.profile")` → `"/data/instagram/profile"`
  7. `generateCollectedAt()` matches ISO 8601 without milliseconds, ends in `Z`
- **Verify:** `npx vitest run packages/core/src/storage/hierarchy/paths`

---

#### Task 1.2: SQLite index types + schema
- **Status:** `[x]`
- **Files:** `packages/core/src/storage/index/types.ts`, `packages/core/src/storage/index/schema.ts`, `packages/core/src/storage/index/schema.test.ts`
- **Deps:** 0.1
- **Spec:**

  `types.ts`:
  ```typescript
  export interface IndexEntry {
    id: number
    fileId: string | null   // null until synced on-chain (Phase 4)
    path: string            // relative path from dataDir
    scope: string
    collectedAt: string     // ISO 8601
    createdAt: string       // ISO 8601
    sizeBytes: number
  }

  export interface IndexListOptions {
    scope?: string
    limit?: number
    offset?: number
  }
  ```

  `schema.ts`:
  ```typescript
  import Database from 'better-sqlite3'

  /** Open/create SQLite database, run CREATE TABLE IF NOT EXISTS, set WAL mode */
  export function initializeDatabase(dbPath: string): Database.Database
  ```

  Table `data_files`: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `file_id TEXT`, `path TEXT NOT NULL UNIQUE`, `scope TEXT NOT NULL`, `collected_at TEXT NOT NULL`, `created_at TEXT NOT NULL DEFAULT (strftime(...))`, `size_bytes INTEGER NOT NULL DEFAULT 0`.
  Indexes on: `scope`, `collected_at`, `file_id`.

- **Tests (5 cases):**
  1. `initializeDatabase(":memory:")` returns Database instance
  2. Table `data_files` exists (query `sqlite_master`)
  3. All expected columns present (PRAGMA table_info)
  4. WAL mode active
  5. Calling twice on same path is idempotent
- **Verify:** `npx vitest run packages/core/src/storage/index/schema`

---

### Layer 2: Managers

#### Task 2.1: Hierarchy manager (atomic write/read/list/delete)
- **Status:** `[x]`
- **Files:** `packages/core/src/storage/hierarchy/manager.ts`, `packages/core/src/storage/hierarchy/manager.test.ts`, `packages/core/src/storage/hierarchy/index.ts`
- **Deps:** 1.1, 0.3
- **Spec:**

  ```typescript
  import type { DataFileEnvelope } from '../../schemas/data-file.js'

  export interface HierarchyManagerOptions { dataDir: string }

  export interface WriteResult {
    path: string          // absolute path
    relativePath: string  // relative from dataDir
    sizeBytes: number
  }

  /** Atomic write: mkdir -p, write temp file, rename */
  export async function writeDataFile(options: HierarchyManagerOptions, envelope: DataFileEnvelope): Promise<WriteResult>

  /** Read and parse a data file */
  export async function readDataFile(options: HierarchyManagerOptions, scope: string, collectedAt: string): Promise<DataFileEnvelope>

  /** List version filenames for a scope, newest first. Empty array if scope dir doesn't exist. */
  export async function listVersions(options: HierarchyManagerOptions, scope: string): Promise<string[]>

  /** Delete a single data file */
  export async function deleteDataFile(options: HierarchyManagerOptions, scope: string, collectedAt: string): Promise<void>
  ```

  `index.ts` — barrel re-exporting all public symbols from `paths.ts` and `manager.ts`.

- **Tests (10 cases)** using temp directories:
  1. `writeDataFile` creates file at expected path
  2. Written file is valid JSON with correct envelope fields
  3. `writeDataFile` creates intermediate directories
  4. `writeDataFile` returns correct `relativePath`
  5. `writeDataFile` returns `sizeBytes > 0`
  6. Atomic write: file content is complete (no partial writes)
  7. `readDataFile` returns the envelope written by `writeDataFile`
  8. `listVersions` returns filenames in reverse chronological order
  9. `listVersions` returns empty array for nonexistent scope
  10. `deleteDataFile` removes file; subsequent `readDataFile` throws ENOENT
- **Verify:** `npx vitest run packages/core/src/storage/hierarchy/`

---

#### Task 2.2: Index manager (CRUD on SQLite)
- **Status:** `[ ]`
- **Files:** `packages/core/src/storage/index/manager.ts`, `packages/core/src/storage/index/manager.test.ts`, `packages/core/src/storage/index/index.ts`
- **Deps:** 1.2
- **Spec:**

  ```typescript
  import type Database from 'better-sqlite3'
  import type { IndexEntry, IndexListOptions } from './types.js'

  export interface IndexManager {
    insert(entry: Omit<IndexEntry, 'id' | 'createdAt'>): IndexEntry
    findByPath(path: string): IndexEntry | undefined
    findByScope(options: IndexListOptions): IndexEntry[]
    findLatestByScope(scope: string): IndexEntry | undefined
    countByScope(scope: string): number
    deleteByPath(path: string): boolean
    close(): void
  }

  export function createIndexManager(db: Database.Database): IndexManager
  ```

  Uses prepared statements. `findByScope` orders by `collected_at DESC` with `LIMIT`/`OFFSET`.

  `index.ts` — barrel re-exporting types, `initializeDatabase`, `createIndexManager`.

- **Tests (10 cases)** using `:memory:` database:
  1. `insert` returns `IndexEntry` with auto-generated `id` and `createdAt`
  2. `insert` with `fileId: null` stores null
  3. `insert` duplicate path throws unique constraint error
  4. `findByPath` returns inserted entry
  5. `findByPath` returns undefined for nonexistent path
  6. `findByScope` returns entries ordered by collectedAt DESC
  7. `findByScope` respects limit and offset
  8. `findLatestByScope` returns most recent entry
  9. `countByScope` returns correct count
  10. `deleteByPath` returns true when exists, false otherwise
- **Verify:** `npx vitest run packages/core/src/storage/index/`

---

### Layer 3: Route + Integration

#### Task 3.1: Body size limit middleware
- **Status:** `[ ]`
- **Files:** `packages/server/src/middleware/body-limit.ts`, `packages/server/src/middleware/body-limit.test.ts`
- **Deps:** Phase 0 (Hono available)
- **Spec:**

  ```typescript
  import { bodyLimit } from 'hono/body-limit'

  export function createBodyLimit(maxSize: number)  // returns Hono middleware
  export const DATA_INGEST_MAX_SIZE = 50 * 1024 * 1024  // 50 MB
  export const DEFAULT_MAX_SIZE = 1 * 1024 * 1024       // 1 MB
  ```

  On exceeding limit: return 413 JSON `{ error: "CONTENT_TOO_LARGE", message: "..." }`.

  Note: If `hono/body-limit` API doesn't match, implement a manual Content-Length check middleware instead.

- **Tests (3 cases):**
  1. Request within limit passes through (200)
  2. Request exceeding limit returns 413 with error JSON
  3. Constants correct: `DATA_INGEST_MAX_SIZE === 52428800`, `DEFAULT_MAX_SIZE === 1048576`
- **Verify:** `npx vitest run packages/server/src/middleware/`

---

#### Task 3.2: POST /v1/data/{scope} route + tests
- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/data.ts`, `packages/server/src/routes/data.test.ts`
- **Deps:** 2.1, 2.2, 0.3, 3.1
- **Spec:**

  ```typescript
  import { Hono } from 'hono'
  import type { IndexManager } from '@personal-server/core/storage/index'
  import type { HierarchyManagerOptions } from '@personal-server/core/storage/hierarchy'
  import type { Logger } from 'pino'

  export interface DataRouteDeps {
    indexManager: IndexManager
    hierarchyOptions: HierarchyManagerOptions
    logger: Logger
  }

  export function dataRoutes(deps: DataRouteDeps): Hono
  ```

  `POST /:scope` handler flow:
  1. Parse & validate scope from URL param (400 if invalid)
  2. Parse JSON body (400 if invalid or not an object)
  3. Generate `collectedAt` via `generateCollectedAt()`
  4. Construct envelope via `createDataFileEnvelope(scope, collectedAt, body)`
  5. Write atomically via `writeDataFile(hierarchyOptions, envelope)`
  6. Insert into index via `indexManager.insert({ fileId: null, path, scope, collectedAt, sizeBytes })`
  7. Return 201: `{ scope, collectedAt, status: "stored" }`
  8. Body size limit: 50 MB via `createBodyLimit(DATA_INGEST_MAX_SIZE)`

- **Tests (9 cases)** using temp dir + `:memory:` SQLite:
  1. POST valid scope + body → 201 with `{ scope, collectedAt, status: "stored" }`
  2. Response `collectedAt` is valid ISO 8601
  3. File written to correct path on disk
  4. File content is valid DataFileEnvelope with `version: "1.0"`
  5. SQLite index has matching row
  6. POST invalid scope (e.g. `"bad"`) → 400
  7. POST non-JSON body → 400
  8. POST with array body → 400
  9. POST two files to same scope creates two separate versions
- **Verify:** `npx vitest run packages/server/src/routes/data`

---

#### Task 3.3: Update bootstrap.ts + app.ts
- **Status:** `[ ]`
- **Files:** `packages/server/src/bootstrap.ts` (modify), `packages/server/src/app.ts` (modify)
- **Deps:** 3.2
- **Spec:**

  **bootstrap.ts** modifications:
  - Import `initializeDatabase`, `createIndexManager` from `@personal-server/core/storage/index`
  - Derive `dataDir = join(configDir, 'data')`, `indexPath = join(configDir, 'index.db')`
  - Initialize SQLite database and create index manager
  - Add `indexManager`, `hierarchyOptions`, `cleanup()` to `ServerContext`
  - `cleanup()` calls `indexManager.close()`

  **app.ts** modifications:
  - Accept `indexManager` and `hierarchyOptions` in deps
  - Mount `dataRoutes(deps)` at `/v1/data`

  Updated `ServerContext`:
  ```typescript
  export interface ServerContext {
    app: Hono
    logger: Logger
    config: ServerConfig
    startedAt: Date
    indexManager: IndexManager
    cleanup: () => void
  }
  ```

- **Tests** (update existing + 4 new):
  1. `ServerContext` has `indexManager` property
  2. `ServerContext` has `cleanup` function
  3. App responds to POST /v1/data/test.scope with 201
  4. `cleanup()` can be called without error
- **Verify:** `npx vitest run packages/server/src/bootstrap.test.ts && npx vitest run packages/server/src/app.test.ts`

---

### Layer 4: Final Verification

#### Task 4.1: Install, build, test
- **Status:** `[ ]`
- **Deps:** all previous
- **Steps:**
  1. `npm install` — succeeds (better-sqlite3 native module compiles)
  2. `npm run build` (`tsc --build`) — all 3 packages compile
  3. `npm test` (`vitest run`) — all tests pass (Phase 0 + Phase 1)
  4. `node packages/server/dist/index.js` — server starts
  5. `curl -X POST http://localhost:8080/v1/data/test.scope -H "Content-Type: application/json" -d '{"hello":"world"}'` — returns 201 with `{ scope, collectedAt, status: "stored" }`
  6. Verify file at `~/.vana/data/test/scope/{timestamp}.json`
  7. Verify `~/.vana/index.db` has a row
  8. Ctrl+C — graceful shutdown, DB closed

---

## File Inventory (21 file operations)

| Task | File | New/Modified |
|------|------|-------------|
| 0.1 | `packages/core/package.json` | Modified |
| 0.2 | `packages/core/src/scopes/parse.ts` | New |
| 0.2 | `packages/core/src/scopes/parse.test.ts` | New |
| 0.3 | `packages/core/src/schemas/data-file.ts` | New |
| 0.3 | `packages/core/src/schemas/data-file.test.ts` | New |
| 1.1 | `packages/core/src/storage/hierarchy/paths.ts` | New |
| 1.1 | `packages/core/src/storage/hierarchy/paths.test.ts` | New |
| 1.2 | `packages/core/src/storage/index/types.ts` | New |
| 1.2 | `packages/core/src/storage/index/schema.ts` | New |
| 1.2 | `packages/core/src/storage/index/schema.test.ts` | New |
| 2.1 | `packages/core/src/storage/hierarchy/manager.ts` | New |
| 2.1 | `packages/core/src/storage/hierarchy/manager.test.ts` | New |
| 2.1 | `packages/core/src/storage/hierarchy/index.ts` | New |
| 2.2 | `packages/core/src/storage/index/manager.ts` | New |
| 2.2 | `packages/core/src/storage/index/manager.test.ts` | New |
| 2.2 | `packages/core/src/storage/index/index.ts` | New |
| 3.1 | `packages/server/src/middleware/body-limit.ts` | New |
| 3.1 | `packages/server/src/middleware/body-limit.test.ts` | New |
| 3.2 | `packages/server/src/routes/data.ts` | New |
| 3.2 | `packages/server/src/routes/data.test.ts` | New |
| 3.3 | `packages/server/src/bootstrap.ts` | Modified |
| 3.3 | `packages/server/src/app.ts` | Modified |

**Total: 18 new files, 3 modified files**

---

## Agent Parallelism Strategy

| Batch | Tasks | Agents | Notes |
|-------|-------|--------|-------|
| 1 | 0.1, 0.2, 0.3 | 3 parallel | All independent |
| 2 | 1.1, 1.2 | 2 parallel | 1.1 needs 0.2; 1.2 needs 0.1 |
| 3 | 2.1, 2.2, 3.1 | 3 parallel | 2.1 needs 1.1+0.3; 2.2 needs 1.2; 3.1 is independent |
| 4 | 3.2 | 1 | Needs 2.1+2.2+3.1 |
| 5 | 3.3 | 1 | Modifies existing files, needs 3.2 |
| 6 | 4.1 | 1 | Verification only |

---

## Design Notes

- **`status: "stored"` not `"syncing"`** — Phase 1 has no sync. Phase 4 changes this.
- **`$schema` omitted** — Requires Gateway schema lookup (Phase 3).
- **No auth on POST** — Phase 2 adds Web3Signed auth. Scaffold note: localhost-only MAY skip auth.
- **Scope regex `[a-z][a-z0-9_]*`** — Lowercase, starts with letter, underscores allowed (matches spec examples like `watch_history`).
- **`sizeBytes` in index** — Avoids extra `stat()` calls later; hierarchy manager already has the size after write.
- **`configDir` derivation** — `dataDir = join(configDir, 'data')`, `indexPath = join(configDir, 'index.db')`. The `configDir` comes from Phase 0's `DEFAULT_CONFIG_DIR` (~/.vana).
