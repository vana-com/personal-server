# Phase 4: Sync Engine + Storage Backend — Atomic Implementation Plan

## Goal

Deliver the sync engine: OpenPGP password-based encryption/decryption (vana-sdk format compatible), Vana Storage adapter (placeholder REST API), cursor-based upload/download workers, background sync manager, and real sync route implementations. After Phase 4, the server can encrypt data files with per-scope HKDF-derived keys (used as OpenPGP passwords), upload to Vana Storage, register files on-chain via Gateway, download and decrypt files from other Personal Server instances, and resume from crash via `lastProcessedTimestamp` cursor.

**Prerequisite:** Phase 3 complete (all tasks marked `[x]` in `docs/260128-phase-3-implementation-plan.md`)
**Source of truth:** `docs/260127-personal-server-scaffold.md` (Phase 4, sections 4.6, file tree)
**Vana protocol spec:** `docs/260121-data-portability-protocol-spec.md` (sections 4.1.5 step 9, 4.1.6, 4.1.7, 5.2, 7.1.1)

---

## Scope Decisions

- **Vana Storage only** — no GDrive, Dropbox, or IPFS adapters. `StorageBackend` enum already exists but only `vana` is implemented.
- **Real Vana Storage API** at `storage.vana.com` — `PUT`/`GET`/`DELETE`/`HEAD` against `{apiUrl}/v1/blobs/{ownerAddress}/{key}` with `Web3Signed` auth. Vana Storage service is defined in `docs/vana-storage-design.md` and built in a separate repo.
- **Adds `openpgp` dependency** — for OpenPGP password-based encryption (vana-sdk format compatible). Produces the same binary format as vana-sdk, enabling cross-tool interop.
- **Layer 1 (symmetric) only** — ECIES key wrapping for recipient sharing deferred to a future phase.
- **Per-scope HKDF-derived key used as OpenPGP password** — `hex(deriveScopeKey(masterKey, scope))` is the password passed to OpenPGP (protocol spec §2.3). vana-sdk can be updated to accept custom keys for interop.
- **Sync opt-in** — sync only runs when `sync.enabled === true` in config AND `VANA_MASTER_KEY_SIGNATURE` env var is set. Without both, server operates in local-only mode (Phase 0–3 behavior preserved).

---

## Dependency Graph

```
Layer 0 (all parallel, no deps beyond Phase 3):
  0.1  Sync types (FileRecord, SyncStatus, etc.)
  0.2  Config schema: add sync.enabled, sync.lastProcessedTimestamp, storage.config.vana + saveConfig
  0.3  OpenPGP password-based encryption/decryption (vana-sdk format)
  0.4  StorageAdapter interface
  0.5  GatewayClient: add registerFile, getFile, listFilesSince, getSchema

Layer 1 (after Layer 0):
  1.1  Vana Storage adapter (real API)                     (after 0.4)
  1.2  IndexManager: add findUnsynced, updateFileId       (after 0.1)
  1.3  Sync cursor (read/write lastProcessedTimestamp)    (after 0.2)

Layer 2 (after Layer 1):
  2.1  Upload worker                                      (after 0.3, 0.5, 1.1, 1.2)
  2.2  Download worker                                    (after 0.3, 0.5, 1.1, 1.2, 1.3)

Layer 3 (after Layer 2):
  3.1  SyncManager (background loop, upload queue, crash recovery)  (after 2.1, 2.2, 1.3)
  3.2  Replace sync stub routes with real implementations           (after 3.1)

Layer 4 (after Layer 3):
  4.1  POST /v1/data/:scope triggers async upload, returns "syncing"  (after 3.1)
  4.2  Wire sync into bootstrap.ts, app.ts, ServerContext, package.json exports  (after 3.1, 3.2, 4.1)

Layer 5 (final):
  5.1  npm install + build + test + verify
```

**Critical path:** 0.3 → (0.4 → 1.1) → 2.1 → 3.1 → 4.2 → 5.1

---

## Tasks

### Layer 0: Foundation (all parallel)

#### Task 0.1: Sync types

- **Status:** `[x]`
- **Files:** `packages/core/src/sync/types.ts` (new), `packages/core/src/sync/index.ts` (new)
- **Deps:** Phase 3 complete
- **Spec:**

  `types.ts`:

  ```typescript
  /** On-chain file record returned by Gateway DP RPC */
  export interface FileRecord {
    fileId: string;
    owner: string;
    url: string; // e.g. "https://storage.vana.com/v1/blobs/{ownerAddress}/{scope}/{collectedAt}"
    schemaId: string;
    createdAt: string; // ISO 8601
  }

  /** Result from Gateway listFilesSince */
  export interface FileListResult {
    files: FileRecord[];
    cursor: string | null; // next lastProcessedTimestamp, null if caught up
  }

  /** Parameters for registering a file on-chain via Gateway */
  export interface RegisterFileParams {
    url: string;
    schemaId: string;
    owner: string;
  }

  /** Response from Gateway registerFile */
  export interface FileRegistration {
    fileId: string;
    status: "pending" | "confirmed";
  }

  // NOTE: No EncryptedBlob interface — OpenPGP handles its own framing.

  /** Sync engine status for GET /v1/sync/status */
  export interface SyncStatus {
    enabled: boolean;
    running: boolean;
    lastSync: string | null; // ISO 8601
    lastProcessedTimestamp: string | null;
    pendingFiles: number;
    errors: SyncError[];
  }

  export interface SyncError {
    fileId: string | null;
    scope: string | null;
    message: string;
    timestamp: string;
  }
  ```

  `index.ts` — barrel re-export of all types.

- **Done when:** Types compile, barrel export works
- **Verify:** `npm run build`

---

#### Task 0.2: Config schema — add sync + saveConfig

- **Status:** `[x]`
- **Files:** `packages/core/src/schemas/server-config.ts` (modify), `packages/core/src/config/loader.ts` (modify), `packages/core/src/config/index.ts` (modify), `packages/core/src/schemas/server-config.test.ts` (new)
- **Deps:** Phase 3 complete
- **Spec:**

  Update `ServerConfigSchema` in `server-config.ts`:

  ```typescript
  export const VanaStorageConfigSchema = z.object({
    apiUrl: z.string().url().default("https://storage.vana.com"),
  });

  export const ServerConfigSchema = z.object({
    server: z
      .object({
        port: z.number().int().min(1).max(65535).default(8080),
        address: z.string().optional(),
        origin: z.string().url().optional(),
      })
      .default({}),
    gatewayUrl: z.string().url().default("https://rpc.vana.org"),
    logging: LoggingConfigSchema.default({}),
    storage: z
      .object({
        backend: StorageBackend.default("local"),
        config: z
          .object({
            vana: VanaStorageConfigSchema.optional(),
          })
          .default({}),
      })
      .default({}),
    sync: z
      .object({
        enabled: z.boolean().default(false),
        lastProcessedTimestamp: z.string().datetime().nullable().default(null),
      })
      .default({}),
  });
  ```

  Add `saveConfig` to `loader.ts`:

  ```typescript
  import { writeFile, mkdir } from "node:fs/promises";
  import { dirname } from "node:path";

  export async function saveConfig(
    config: ServerConfig,
    options?: { configPath?: string },
  ): Promise<void> {
    const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }
  ```

  Re-export `saveConfig` from `config/index.ts`.

- **Tests (6 cases):**
  1. Default config has `sync.enabled: false`, `sync.lastProcessedTimestamp: null`
  2. `sync.enabled: true` parses correctly
  3. `sync.lastProcessedTimestamp: "2026-01-21T10:00:00Z"` parses correctly
  4. `storage.config.vana.apiUrl` defaults to `https://storage.vana.com`
  5. `saveConfig` writes JSON file, `loadConfig` reads it back identically
  6. `saveConfig` creates parent directory if missing
- **Verify:** `npx vitest run packages/core/src/schemas/server-config && npx vitest run packages/core/src/config/`

---

#### Task 0.3: OpenPGP password-based encryption/decryption (vana-sdk format)

- **Status:** `[x]`
- **Files:** `packages/core/src/storage/encryption/encrypt.ts` (new), `packages/core/src/storage/encryption/decrypt.ts` (new), `packages/core/src/storage/encryption/index.ts` (new), `packages/core/src/storage/encryption/encrypt.test.ts` (new), `packages/core/package.json` (modify — add `openpgp` dependency)
- **Deps:** Phase 3 (keys/derive.ts provides `deriveScopeKey`)
- **Spec:**

  Add to `packages/core/package.json` dependencies:

  ```json
  "openpgp": "^6.1.0"
  ```

  `encrypt.ts`:

  ```typescript
  import * as openpgp from "openpgp";

  /**
   * Encrypt plaintext using OpenPGP password-based encryption.
   * Produces the same binary format as vana-sdk.
   *
   * @param plaintext - data to encrypt (typically JSON.stringify of envelope)
   * @param password - hex-encoded scope key from deriveScopeKey()
   * @returns OpenPGP encrypted binary (Uint8Array)
   */
  export async function encryptWithPassword(
    plaintext: Uint8Array,
    password: string,
  ): Promise<Uint8Array> {
    const message = await openpgp.createMessage({ binary: plaintext });
    const encrypted = await openpgp.encrypt({
      message,
      passwords: [password],
      format: "binary",
    });
    return encrypted as Uint8Array;
  }
  ```

  `decrypt.ts`:

  ```typescript
  import * as openpgp from "openpgp";

  /**
   * Decrypt an OpenPGP password-encrypted binary.
   *
   * @param encrypted - OpenPGP encrypted binary data
   * @param password - hex-encoded scope key
   * @returns plaintext Uint8Array
   * @throws if password is wrong or data is corrupted
   */
  export async function decryptWithPassword(
    encrypted: Uint8Array,
    password: string,
  ): Promise<Uint8Array> {
    const message = await openpgp.readMessage({ binaryMessage: encrypted });
    const { data } = await openpgp.decrypt({
      message,
      passwords: [password],
      format: "binary",
    });
    return data as Uint8Array;
  }
  ```

  `index.ts` — barrel re-export of `encryptWithPassword`, `decryptWithPassword`.

  NOTE: No `serializeBlob`/`deserializeBlob` — OpenPGP handles its own framing.
  The password is derived as: `Buffer.from(deriveScopeKey(masterKey, scope)).toString('hex')`

- **Tests (6 cases):**
  1. `encryptWithPassword` + `decryptWithPassword` roundtrip returns original plaintext
  2. Different calls produce different ciphertext (OpenPGP uses random session key)
  3. Decrypt with wrong password throws
  4. Decrypt with corrupted ciphertext throws
  5. Large payload (1MB) encrypts/decrypts correctly
  6. Cross-compat: output can be decrypted by openpgp CLI / raw openpgp.decrypt
- **Verify:** `npx vitest run packages/core/src/storage/encryption/`

---

#### Task 0.4: StorageAdapter interface

- **Status:** `[x]`
- **Files:** `packages/core/src/storage/adapters/interface.ts` (new), `packages/core/src/storage/adapters/index.ts` (new)
- **Deps:** Phase 3 complete
- **Spec:**

  `interface.ts`:

  ```typescript
  /**
   * Abstract storage backend adapter.
   * All methods operate on encrypted binary blobs.
   * Keys are opaque strings (e.g., "{scope}/{collectedAt}").
   */
  export interface StorageAdapter {
    /**
     * Upload an encrypted blob to the storage backend.
     * @param key - unique storage key / path
     * @param data - encrypted binary data
     * @returns URL where the blob is accessible
     */
    upload(key: string, data: Uint8Array): Promise<string>;

    /**
     * Download an encrypted blob from the storage backend.
     * @param url - storage URL returned by upload()
     * @returns encrypted binary data
     * @throws if blob not found
     */
    download(url: string): Promise<Uint8Array>;

    /**
     * Delete an encrypted blob from the storage backend.
     * @param url - storage URL
     * @returns true if deleted, false if not found
     */
    delete(url: string): Promise<boolean>;

    /**
     * Check if a blob exists in the storage backend.
     * @param url - storage URL
     * @returns true if blob exists
     */
    exists(url: string): Promise<boolean>;

    /**
     * Bulk delete all blobs for a scope.
     * Optional — not all backends support bulk delete.
     * @param scope - scope identifier (dot notation)
     * @returns count of blobs deleted
     */
    deleteScope?(scope: string): Promise<number>;

    /**
     * Delete all blobs for the owner.
     * Optional — not all backends support bulk delete.
     * @returns count of blobs deleted
     */
    deleteAll?(): Promise<number>;
  }
  ```

  `index.ts` — barrel re-export.

- **Done when:** Interface compiles, exports resolve
- **Verify:** `npm run build`

---

#### Task 0.5: GatewayClient — add registerFile, getFile, listFilesSince, getSchema

- **Status:** `[x]`
- **Files:** `packages/core/src/gateway/client.ts` (modify), `packages/core/src/gateway/client.test.ts` (modify)
- **Deps:** 0.1 (uses `FileRecord`, `FileListResult`, `RegisterFileParams`, `FileRegistration` types)
- **Spec:**

  Add types import:

  ```typescript
  import type {
    FileRecord,
    FileListResult,
    RegisterFileParams,
    FileRegistration,
  } from "../sync/types.js";
  ```

  Add to `GatewayClient` interface:

  ```typescript
  /**
   * Register a file record on-chain via DP RPC.
   * Gateway relays the operation asynchronously.
   */
  registerFile(params: RegisterFileParams): Promise<FileRegistration>

  /**
   * Get a file record by fileId from the on-chain registry.
   */
  getFile(fileId: string): Promise<FileRecord | null>

  /**
   * List file records for an owner since a given timestamp (cursor-based).
   * If cursor is null, returns all file records for the owner.
   */
  listFilesSince(owner: string, cursor: string | null): Promise<FileListResult>

  /**
   * Get schema by schemaId (distinct from getSchemaForScope which queries by scope).
   * Used during download to resolve schemaId → scope.
   */
  getSchema(schemaId: string): Promise<Schema | null>
  ```

  Implementation pattern (same as existing methods):

  `registerFile`: `POST {base}/v1/files` with JSON body → 201 returns `FileRegistration`
  `getFile`: `GET {base}/v1/files/{fileId}` → 200 returns `FileRecord`, 404 returns null
  `listFilesSince`: `GET {base}/v1/files?owner={owner}&since={cursor}` → 200 returns `FileListResult`
  `getSchema`: `GET {base}/v1/schemas/{schemaId}` → 200 returns `Schema`, 404 returns null

- **Tests (8 new cases)** using mocked fetch:
  1. `registerFile` → returns `FileRegistration` on 201
  2. `registerFile` → throws on non-201 errors
  3. `getFile` → returns `FileRecord` on 200
  4. `getFile` → returns `null` on 404
  5. `listFilesSince` with cursor → includes `since` query param
  6. `listFilesSince` without cursor → omits `since` param
  7. `getSchema` → returns `Schema` on 200
  8. `getSchema` → returns `null` on 404
- **Verify:** `npx vitest run packages/core/src/gateway/`

---

### Layer 1: Implementations

#### Task 1.1: Vana Storage adapter (real API)

- **Status:** `[ ]`
- **Files:** `packages/core/src/storage/adapters/vana.ts` (new), `packages/core/src/storage/adapters/vana.test.ts` (new)
- **Deps:** 0.4
- **Spec:**

  Targets the real Vana Storage API at `storage.vana.com` (see `docs/vana-storage-design.md` Section 7 for delta details).

  ```typescript
  import type { StorageAdapter } from "./interface.js";
  import type { ServerSigner } from "../../identity/index.js";

  export interface VanaStorageOptions {
    apiUrl: string; // e.g. "https://storage.vana.com"
    ownerAddress: string; // owner Ethereum address
    signer: ServerSigner; // for Web3Signed auth headers
  }

  /**
   * Vana Storage adapter.
   * Uses REST: PUT/GET/DELETE/HEAD against {apiUrl}/v1/blobs/{ownerAddress}/{key}
   * Auth: Web3Signed header on all requests (see design doc Section 3).
   * URL format: full HTTPS URL (no vana:// scheme).
   */
  export function createVanaStorageAdapter(
    options: VanaStorageOptions,
  ): StorageAdapter {
    const base = options.apiUrl.replace(/\/+$/, "");
    const { ownerAddress, signer } = options;

    function blobUrl(key: string): string {
      return `${base}/v1/blobs/${ownerAddress}/${key}`;
    }

    async function authHeaders(
      method: string,
      uri: string,
      body?: Uint8Array,
    ): Promise<Record<string, string>> {
      const header = await signer.signRequest({
        aud: options.apiUrl,
        method,
        uri,
        body,
      });
      return { Authorization: header };
    }

    return {
      async upload(key, data) {
        const url = blobUrl(key);
        const uri = `/v1/blobs/${ownerAddress}/${key}`;
        const auth = await authHeaders("PUT", uri, data);
        const res = await fetch(url, {
          method: "PUT",
          body: data,
          headers: {
            "Content-Type": "application/octet-stream",
            ...auth,
          },
        });
        if (!res.ok) {
          throw new Error(
            `Vana Storage upload failed: ${res.status} ${res.statusText}`,
          );
        }
        // Return full HTTPS URL (registered with Gateway as-is)
        return url;
      },

      async download(storageUrl) {
        // storageUrl is a full HTTPS URL from DataRegistry
        const uri = new URL(storageUrl).pathname;
        const auth = await authHeaders("GET", uri);
        const res = await fetch(storageUrl, { headers: auth });
        if (res.status === 404) {
          throw new Error(`Blob not found: ${storageUrl}`);
        }
        if (!res.ok) {
          throw new Error(
            `Vana Storage download failed: ${res.status} ${res.statusText}`,
          );
        }
        return new Uint8Array(await res.arrayBuffer());
      },

      async delete(storageUrl) {
        const uri = new URL(storageUrl).pathname;
        const auth = await authHeaders("DELETE", uri);
        const res = await fetch(storageUrl, {
          method: "DELETE",
          headers: auth,
        });
        if (res.status === 404) return false;
        if (!res.ok) {
          throw new Error(
            `Vana Storage delete failed: ${res.status} ${res.statusText}`,
          );
        }
        return true;
      },

      async exists(storageUrl) {
        const uri = new URL(storageUrl).pathname;
        const auth = await authHeaders("HEAD", uri);
        const res = await fetch(storageUrl, { method: "HEAD", headers: auth });
        return res.ok;
      },

      async deleteScope(scope) {
        const url = `${base}/v1/blobs/${ownerAddress}/${scope}`;
        const uri = `/v1/blobs/${ownerAddress}/${scope}`;
        const auth = await authHeaders("DELETE", uri);
        const res = await fetch(url, { method: "DELETE", headers: auth });
        if (!res.ok) {
          throw new Error(
            `Vana Storage deleteScope failed: ${res.status} ${res.statusText}`,
          );
        }
        const body = await res.json();
        return body.count ?? 0;
      },

      async deleteAll() {
        const url = `${base}/v1/blobs/${ownerAddress}`;
        const uri = `/v1/blobs/${ownerAddress}`;
        const auth = await authHeaders("DELETE", uri);
        const res = await fetch(url, { method: "DELETE", headers: auth });
        if (!res.ok) {
          throw new Error(
            `Vana Storage deleteAll failed: ${res.status} ${res.statusText}`,
          );
        }
        const body = await res.json();
        return body.count ?? 0;
      },
    };
  }
  ```

- **Tests (10 cases)** using mocked fetch:
  1. `upload` sends PUT with octet-stream body and Web3Signed auth, returns full HTTPS URL
  2. `upload` throws on non-OK response
  3. `download` fetches blob with auth header, returns Uint8Array
  4. `download` throws on 404
  5. `delete` returns true on success, false on 404, includes auth header
  6. `exists` returns true on 200, false on 404, includes auth header
  7. URL format: `upload("instagram.profile/2026-01-21T10-00-00Z")` returns `https://storage.vana.com/v1/blobs/{ownerAddress}/instagram.profile/2026-01-21T10-00-00Z`
  8. `download`/`delete`/`exists` parse full HTTPS URLs correctly
  9. `deleteScope("instagram.profile")` calls DELETE on scope path, returns count
  10. `deleteAll()` calls DELETE on owner path, returns count
- **Verify:** `npx vitest run packages/core/src/storage/adapters/`

---

#### Task 1.2: IndexManager — add findUnsynced + updateFileId

- **Status:** `[ ]`
- **Files:** `packages/core/src/storage/index/manager.ts` (modify), `packages/core/src/storage/index/manager.test.ts` (modify)
- **Deps:** Phase 3 IndexManager
- **Spec:**

  Add to `IndexManager` interface:

  ```typescript
  /**
   * Find all index entries where fileId is null (not yet synced to storage backend).
   * These form the implicit upload queue — no separate queue file needed.
   * Returns entries ordered by created_at ASC (oldest first).
   */
  findUnsynced(options?: { limit?: number }): IndexEntry[]

  /**
   * Update the fileId for an index entry (after successful upload + on-chain registration).
   * @returns true if row was updated, false if path not found
   */
  updateFileId(path: string, fileId: string): boolean
  ```

  Implementation:

  ```typescript
  const findUnsyncedStmt = db.prepare(
    'SELECT * FROM data_files WHERE file_id IS NULL ORDER BY created_at ASC',
  )
  const findUnsyncedLimitStmt = db.prepare(
    'SELECT * FROM data_files WHERE file_id IS NULL ORDER BY created_at ASC LIMIT @limit',
  )
  const updateFileIdStmt = db.prepare<{ file_id: string; path: string }>(
    'UPDATE data_files SET file_id = @file_id WHERE path = @path',
  )

  findUnsynced(options) {
    if (options?.limit !== undefined) {
      const rows = findUnsyncedLimitStmt.all({ limit: options.limit }) as RawRow[]
      return rows.map(rowToEntry)
    }
    const rows = findUnsyncedStmt.all() as RawRow[]
    return rows.map(rowToEntry)
  },

  updateFileId(path, fileId) {
    const result = updateFileIdStmt.run({ file_id: fileId, path })
    return result.changes > 0
  },
  ```

- **Tests (5 new cases):**
  1. `findUnsynced` returns entries with `fileId === null`
  2. `findUnsynced` excludes entries with `fileId !== null`
  3. `findUnsynced({ limit: 2 })` returns at most 2 entries
  4. `updateFileId` sets fileId, entry no longer appears in `findUnsynced`
  5. `updateFileId` returns false for nonexistent path
- **Verify:** `npx vitest run packages/core/src/storage/index/manager`

---

#### Task 1.3: Sync cursor

- **Status:** `[ ]`
- **Files:** `packages/core/src/sync/cursor.ts` (new), `packages/core/src/sync/cursor.test.ts` (new)
- **Deps:** 0.2 (saveConfig, loadConfig, sync.lastProcessedTimestamp)
- **Spec:**

  ```typescript
  import {
    loadConfig,
    saveConfig,
    type LoadConfigOptions,
  } from "../config/index.js";

  export interface SyncCursor {
    /** Read the lastProcessedTimestamp from server.json */
    read(): Promise<string | null>;

    /** Write the lastProcessedTimestamp to server.json */
    write(timestamp: string): Promise<void>;
  }

  /**
   * Creates a cursor that reads/writes sync.lastProcessedTimestamp in server.json.
   * Uses loadConfig/saveConfig to preserve other config fields.
   */
  export function createSyncCursor(configPath: string): SyncCursor {
    return {
      async read() {
        const config = await loadConfig({ configPath });
        return config.sync.lastProcessedTimestamp;
      },

      async write(timestamp) {
        const config = await loadConfig({ configPath });
        config.sync.lastProcessedTimestamp = timestamp;
        await saveConfig(config, { configPath });
      },
    };
  }
  ```

- **Tests (4 cases)** using temp file:
  1. `read` returns `null` when config has default sync
  2. `write("2026-01-21T10:00:00Z")` then `read` returns the same timestamp
  3. `write` preserves other config fields (server.port, logging.level, etc.)
  4. `write` creates config file if it doesn't exist
- **Verify:** `npx vitest run packages/core/src/sync/cursor`

---

### Layer 2: Workers

#### Task 2.1: Upload worker

- **Status:** `[ ]`
- **Files:** `packages/core/src/sync/workers/upload.ts` (new), `packages/core/src/sync/workers/upload.test.ts` (new)
- **Deps:** 0.3, 0.5, 1.1, 1.2
- **Spec:**

  ```typescript
  import type { IndexManager } from "../../storage/index/manager.js";
  import type { HierarchyManagerOptions } from "../../storage/hierarchy/index.js";
  import type { StorageAdapter } from "../../storage/adapters/interface.js";
  import type { GatewayClient, Schema } from "../../gateway/client.js";
  import type { Logger } from "pino";
  import { readDataFile } from "../../storage/hierarchy/index.js";
  import { deriveScopeKey } from "../../keys/derive.js";
  import { encryptWithPassword } from "../../storage/encryption/index.js";
  import type { IndexEntry } from "../../storage/index/types.js";

  export interface UploadWorkerDeps {
    indexManager: IndexManager;
    hierarchyOptions: HierarchyManagerOptions;
    storageAdapter: StorageAdapter;
    gateway: GatewayClient;
    masterKey: Uint8Array;
    serverOwner: string;
    logger: Logger;
  }

  export interface UploadResult {
    path: string;
    fileId: string;
    url: string;
  }

  /**
   * Upload a single unsynced index entry:
   * 1. Read local data file from disk
   * 2. Look up schema for the scope → get schemaId
   * 3. Derive scope key from master key → hex-encode as OpenPGP password
   * 4. Encrypt with OpenPGP password-based encryption → binary
   * 5. Upload OpenPGP binary to storage backend
   * 6. Register file record on-chain via Gateway (with schemaId)
   * 7. Update local index with fileId
   */
  export async function uploadOne(
    deps: UploadWorkerDeps,
    entry: IndexEntry,
  ): Promise<UploadResult>;

  /**
   * Process all unsynced entries (fileId === null).
   * Processes sequentially to avoid overwhelming storage backend.
   * Returns array of results (skips failures, logs errors).
   */
  export async function uploadAll(
    deps: UploadWorkerDeps,
    options?: { batchSize?: number },
  ): Promise<UploadResult[]>;
  ```

  `uploadOne` implementation flow:
  1. `readDataFile(deps.hierarchyOptions, entry.scope, entry.collectedAt)` → envelope
  2. `deps.gateway.getSchemaForScope(entry.scope)` → schema (throw if null)
  3. `deriveScopeKey(deps.masterKey, entry.scope)` → scopeKey (32 bytes)
  4. `Buffer.from(scopeKey).toString('hex')` → scopeKeyHex (OpenPGP password)
  5. `JSON.stringify(envelope)` → plaintext → `new TextEncoder().encode(plaintext)`
  6. `encryptWithPassword(plaintextBytes, scopeKeyHex)` → OpenPGP binary
  7. `deps.storageAdapter.upload(storageKey, binary)` → url
     - `storageKey` = `${entry.scope}/${entry.collectedAt}` (deterministic, enables dedup)
  8. `deps.gateway.registerFile({ url, schemaId: schema.schemaId, owner: deps.serverOwner })` → `{ fileId }`
  9. `deps.indexManager.updateFileId(entry.path, fileId)`
  10. Return `{ path: entry.path, fileId, url }`

  `uploadAll`:
  1. `deps.indexManager.findUnsynced({ limit: batchSize ?? 50 })` → entries
  2. For each entry: try `uploadOne(deps, entry)`, catch → log error, continue
  3. Return successful results

- **Tests (7 cases)** using mocked deps:
  1. `uploadOne` calls encryptWithPassword with correct scope key hex
  2. `uploadOne` calls storage adapter upload with OpenPGP binary
  3. `uploadOne` calls gateway registerFile with correct schemaId
  4. `uploadOne` updates index with returned fileId
  5. `uploadOne` throws if schema lookup returns null
  6. `uploadAll` processes all unsynced entries
  7. `uploadAll` continues on individual entry failure (logs error)
- **Verify:** `npx vitest run packages/core/src/sync/workers/upload`

---

#### Task 2.2: Download worker

- **Status:** `[ ]`
- **Files:** `packages/core/src/sync/workers/download.ts` (new), `packages/core/src/sync/workers/download.test.ts` (new)
- **Deps:** 0.3, 0.5, 1.1, 1.2, 1.3
- **Spec:**

  ```typescript
  import type { IndexManager } from "../../storage/index/manager.js";
  import type { HierarchyManagerOptions } from "../../storage/hierarchy/index.js";
  import type { StorageAdapter } from "../../storage/adapters/interface.js";
  import type { GatewayClient } from "../../gateway/client.js";
  import type { SyncCursor } from "../cursor.js";
  import type { FileRecord } from "../types.js";
  import type { Logger } from "pino";
  import { writeDataFile } from "../../storage/hierarchy/index.js";
  import { deriveScopeKey } from "../../keys/derive.js";
  import { decryptWithPassword } from "../../storage/encryption/index.js";
  import { DataFileEnvelopeSchema } from "../../schemas/data-file.js";

  export interface DownloadWorkerDeps {
    indexManager: IndexManager;
    hierarchyOptions: HierarchyManagerOptions;
    storageAdapter: StorageAdapter;
    gateway: GatewayClient;
    cursor: SyncCursor;
    masterKey: Uint8Array;
    logger: Logger;
  }

  export interface DownloadResult {
    fileId: string;
    scope: string;
    collectedAt: string;
    path: string;
  }

  /**
   * Download and process a single file record from the storage backend:
   * 1. Check dedup: skip if fileId already in local index
   * 2. Download OpenPGP encrypted binary from storage backend
   * 3. Resolve schemaId → scope via Gateway getSchema
   * 4. Derive scope key from master key → hex-encode as OpenPGP password
   * 5. Decrypt with OpenPGP password-based decryption → plaintext JSON
   * 6. Parse as DataFileEnvelope (validate)
   * 7. Write to local filesystem via hierarchy manager
   * 8. Insert into local index (with fileId)
   */
  export async function downloadOne(
    deps: DownloadWorkerDeps,
    record: FileRecord,
  ): Promise<DownloadResult | null>;

  /**
   * Poll Gateway for new file records since lastProcessedTimestamp,
   * download each, and advance the cursor.
   */
  export async function downloadAll(
    deps: DownloadWorkerDeps,
  ): Promise<DownloadResult[]>;
  ```

  `downloadOne` implementation flow:
  1. `deps.indexManager.findByFileId(record.fileId)` → if exists, return null (dedup)
  2. `deps.storageAdapter.download(record.url)` → OpenPGP encrypted binary
  3. `deps.gateway.getSchema(record.schemaId)` → schema → `schema.scope`
  4. `deriveScopeKey(deps.masterKey, schema.scope)` → scopeKey
  5. `Buffer.from(scopeKey).toString('hex')` → scopeKeyHex (OpenPGP password)
  6. `decryptWithPassword(binary, scopeKeyHex)` → plaintext bytes
  7. `JSON.parse(new TextDecoder().decode(plaintext))` → raw object
  8. `DataFileEnvelopeSchema.parse(raw)` → validated envelope
  9. `writeDataFile(deps.hierarchyOptions, envelope)` → `{ path, relativePath, sizeBytes }`
  10. `deps.indexManager.insert({ fileId: record.fileId, path: relativePath, scope: envelope.scope, collectedAt: envelope.collectedAt, sizeBytes })`
  11. Return `{ fileId: record.fileId, scope: envelope.scope, collectedAt: envelope.collectedAt, path: relativePath }`

  `downloadAll`:
  1. `deps.cursor.read()` → lastProcessedTimestamp
  2. `deps.gateway.listFilesSince(owner, lastProcessedTimestamp)` → `{ files, cursor: nextCursor }`
  3. For each file: try `downloadOne(deps, file)`, catch → log error, continue
  4. If `nextCursor !== null`: `deps.cursor.write(nextCursor)` → advance cursor
  5. Return successful results (filter nulls from dedup)

- **Tests (8 cases)** using mocked deps:
  1. `downloadOne` skips if fileId already in index (dedup)
  2. `downloadOne` downloads, decrypts, writes, and indexes file
  3. `downloadOne` resolves schemaId → scope via gateway.getSchema
  4. `downloadOne` validates envelope against DataFileEnvelopeSchema
  5. `downloadOne` throws on decrypt failure (wrong key / corrupted)
  6. `downloadAll` polls gateway with cursor from config
  7. `downloadAll` advances cursor after processing
  8. `downloadAll` continues on individual file failure
- **Verify:** `npx vitest run packages/core/src/sync/workers/download`

---

### Layer 3: Engine + Routes

#### Task 3.1: SyncManager (background loop, upload queue, crash recovery)

- **Status:** `[ ]`
- **Files:** `packages/core/src/sync/engine/sync-manager.ts` (new), `packages/core/src/sync/engine/sync-manager.test.ts` (new)
- **Deps:** 2.1, 2.2, 1.3
- **Spec:**

  ```typescript
  import type { UploadWorkerDeps } from "../workers/upload.js";
  import type { DownloadWorkerDeps } from "../workers/download.js";
  import type { SyncCursor } from "../cursor.js";
  import type { SyncStatus, SyncError } from "../types.js";
  import type { Logger } from "pino";
  import { uploadAll } from "../workers/upload.js";
  import { downloadAll } from "../workers/download.js";

  export interface SyncManagerOptions {
    /** Polling interval in milliseconds (default: 60_000 = 1 minute) */
    pollInterval?: number;
    /** Max upload batch size per cycle (default: 50) */
    uploadBatchSize?: number;
  }

  export interface SyncManager {
    /** Start the background sync loop */
    start(): void;

    /** Stop the background sync loop gracefully */
    stop(): Promise<void>;

    /** Trigger an immediate sync cycle (skips wait) */
    trigger(): Promise<void>;

    /** Get current sync status */
    getStatus(): SyncStatus;

    /** Queue a single entry for upload (called when new data is ingested) */
    notifyNewData(): void;

    /** Whether the sync manager is currently running */
    readonly running: boolean;
  }

  export function createSyncManager(
    uploadDeps: UploadWorkerDeps,
    downloadDeps: DownloadWorkerDeps,
    options?: SyncManagerOptions,
  ): SyncManager;
  ```

  Implementation:
  - Background loop uses `setInterval` with `pollInterval` (default 60s)
  - Each cycle: run `uploadAll` → run `downloadAll` → update `lastSync` timestamp
  - `trigger()` clears current interval, runs a cycle immediately, then restarts interval
  - `notifyNewData()` is a no-op signal (the next cycle picks up unsynced entries automatically)
  - `getStatus()` returns `SyncStatus` with `enabled: true`, `running`, `lastSync`, `lastProcessedTimestamp` (from cursor), `pendingFiles` (from `indexManager.findUnsynced().length`), and recent `errors`
  - `stop()` clears interval, waits for any in-flight cycle to complete
  - Crash recovery: on `start()`, immediately runs one cycle (picks up unsynced entries from previous crash)
  - Errors are captured in a ring buffer (last 10) for `getStatus().errors`

- **Tests (8 cases)** using mocked deps and fake timers:
  1. `start()` triggers an immediate sync cycle
  2. `stop()` prevents further cycles
  3. `trigger()` runs a cycle immediately
  4. `getStatus()` returns correct pending count
  5. `getStatus().running` reflects lifecycle
  6. Upload errors captured in `getStatus().errors`
  7. Crash recovery: unsynced entries from previous session are uploaded
  8. Multiple `start()` calls are idempotent (no duplicate intervals)
- **Verify:** `npx vitest run packages/core/src/sync/engine/`

---

#### Task 3.2: Replace sync stub routes with real implementations

- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/sync.ts` (modify), `packages/server/src/routes/sync.test.ts` (modify)
- **Deps:** 3.1
- **Spec:**

  Update `SyncRouteDeps`:

  ```typescript
  import type { SyncManager } from "@personal-server/core/sync";

  export interface SyncRouteDeps {
    logger: Logger;
    serverOrigin: string;
    serverOwner: `0x${string}`;
    syncManager: SyncManager | null; // null when sync disabled
  }
  ```

  Replace stub handlers:

  `POST /trigger`:

  ```typescript
  app.post("/trigger", web3Auth, ownerCheck, async (c) => {
    if (!deps.syncManager) {
      return c.json(
        { status: "disabled", message: "Sync is not enabled" },
        200,
      );
    }
    await deps.syncManager.trigger();
    return c.json({ status: "started", message: "Sync triggered" }, 202);
  });
  ```

  `GET /status`:

  ```typescript
  app.get("/status", web3Auth, ownerCheck, async (c) => {
    if (!deps.syncManager) {
      return c.json({
        enabled: false,
        running: false,
        lastSync: null,
        lastProcessedTimestamp: null,
        pendingFiles: 0,
        errors: [],
      });
    }
    return c.json(deps.syncManager.getStatus());
  });
  ```

  `POST /file/:fileId`:

  ```typescript
  app.post("/file/:fileId", web3Auth, ownerCheck, async (c) => {
    const fileId = c.req.param("fileId");
    if (!deps.syncManager) {
      return c.json(
        { fileId, status: "disabled", message: "Sync is not enabled" },
        200,
      );
    }
    // Trigger a full sync (individual file sync is handled by the download worker
    // when it encounters the fileId from Gateway)
    deps.logger.info({ fileId }, "File sync requested, triggering full sync");
    await deps.syncManager.trigger();
    return c.json({ fileId, status: "started" }, 202);
  });
  ```

- **Tests (6 cases):**
  1. POST /trigger with syncManager → 202
  2. POST /trigger without syncManager (null) → 200 disabled
  3. GET /status with syncManager → returns SyncStatus shape
  4. GET /status without syncManager → returns disabled status
  5. POST /file/0x123 with syncManager → 202
  6. POST /file/0x123 without syncManager → 200 disabled
- **Verify:** `npx vitest run packages/server/src/routes/sync`

---

### Layer 4: Integration

#### Task 4.1: POST /v1/data/:scope triggers async upload

- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/data.ts` (modify), `packages/server/src/routes/data.test.ts` (modify)
- **Deps:** 3.1
- **Spec:**

  Update `DataRouteDeps`:

  ```typescript
  export interface DataRouteDeps {
    // ... existing fields ...
    syncManager: SyncManager | null; // null when sync disabled
  }
  ```

  Modify POST `/:scope` handler — after successful insert into index:

  ```typescript
  // 8. Notify sync manager of new data (if enabled)
  let status: "stored" | "syncing" = "stored";
  if (deps.syncManager) {
    deps.syncManager.notifyNewData();
    status = "syncing";
  }

  // 9. Return 201
  return c.json({ scope, collectedAt, status }, 201);
  ```

  When sync is disabled (`syncManager === null`), behavior is unchanged: returns `status: "stored"`.
  When sync is enabled, returns `status: "syncing"` and the background sync loop picks up the unsynced entry.

- **Tests (3 new cases):**
  1. POST with syncManager → 201 `{ status: "syncing" }`
  2. POST without syncManager (null) → 201 `{ status: "stored" }` (backward-compatible)
  3. POST with syncManager calls `notifyNewData()`
- **Verify:** `npx vitest run packages/server/src/routes/data`

---

#### Task 4.2: Wire sync into bootstrap.ts, app.ts, ServerContext, package.json exports

- **Status:** `[ ]`
- **Files:** `packages/server/src/bootstrap.ts` (modify), `packages/server/src/app.ts` (modify), `packages/server/src/bootstrap.test.ts` (modify), `packages/server/src/app.test.ts` (modify), `packages/core/package.json` (modify)
- **Deps:** 3.1, 3.2, 4.1
- **Spec:**

  **core/package.json** — add `openpgp` dependency and new export subpaths:

  ```json
  "dependencies": {
    "openpgp": "^6.1.0"
  }
  ```

  Export subpaths:

  ```json
  "./sync": {
    "types": "./dist/sync/index.d.ts",
    "import": "./dist/sync/index.js"
  },
  "./storage/encryption": {
    "types": "./dist/storage/encryption/index.d.ts",
    "import": "./dist/storage/encryption/index.js"
  },
  "./storage/adapters": {
    "types": "./dist/storage/adapters/index.d.ts",
    "import": "./dist/storage/adapters/index.js"
  }
  ```

  **bootstrap.ts** additions:

  ```typescript
  import { deriveMasterKey } from "@personal-server/core/keys";
  import { createSyncCursor } from "@personal-server/core/sync";
  import {
    createSyncManager,
    type SyncManager,
  } from "@personal-server/core/sync";
  import { createVanaStorageAdapter } from "@personal-server/core/storage/adapters";

  export interface ServerContext {
    // ... existing fields ...
    syncManager: SyncManager | null; // NEW: null when sync disabled
  }

  // In createServer():
  let syncManager: SyncManager | null = null;

  const masterKeySig = process.env.VANA_MASTER_KEY_SIGNATURE;
  if (config.sync.enabled && masterKeySig) {
    const masterKey = deriveMasterKey(masterKeySig as `0x${string}`);

    const vanaConfig = config.storage.config.vana ?? {
      apiUrl: "https://storage.vana.com",
    };
    const signer = createServerSigner(serverKeypair); // ServerSigner from identity module
    const storageAdapter = createVanaStorageAdapter({
      apiUrl: vanaConfig.apiUrl,
      ownerAddress: serverOwner,
      signer,
    });

    const cursor = createSyncCursor(join(configDir, "server.json"));

    const uploadDeps = {
      indexManager,
      hierarchyOptions,
      storageAdapter,
      gateway: gatewayClient,
      masterKey,
      serverOwner,
      logger,
    };

    const downloadDeps = {
      indexManager,
      hierarchyOptions,
      storageAdapter,
      gateway: gatewayClient,
      cursor,
      masterKey,
      logger,
    };

    syncManager = createSyncManager(uploadDeps, downloadDeps);
    syncManager.start();
    logger.info("Sync engine started");
  } else {
    logger.info(
      "Sync disabled (sync.enabled=false or VANA_MASTER_KEY_SIGNATURE not set)",
    );
  }

  // Update cleanup:
  const cleanup = () => {
    if (syncManager) {
      syncManager.stop();
    }
    indexManager.close();
  };

  // Return syncManager in context
  return {
    app,
    logger,
    config,
    startedAt,
    indexManager,
    gatewayClient,
    accessLogReader,
    syncManager,
    cleanup,
  };
  ```

  **app.ts** additions:

  ```typescript
  import type { SyncManager } from '@personal-server/core/sync'

  export interface AppDeps {
    // ... existing fields ...
    syncManager: SyncManager | null   // NEW
  }

  // Pass syncManager to dataRoutes and syncRoutes:
  dataRoutes({ ..., syncManager: deps.syncManager })
  syncRoutes({ ..., syncManager: deps.syncManager })
  ```

- **Tests (6 new/updated cases):**
  1. `ServerContext` has `syncManager` property (null when disabled)
  2. Server starts with sync disabled → `syncManager === null`
  3. Server starts with sync enabled + env var → `syncManager !== null`
  4. `cleanup()` calls `syncManager.stop()` when enabled
  5. App passes syncManager to sync routes
  6. App passes syncManager to data routes
- **Verify:** `npx vitest run packages/server/src/bootstrap && npx vitest run packages/server/src/app`

---

### Layer 5: Final Verification

#### Task 5.1: Install, build, test

- **Status:** `[ ]`
- **Deps:** all previous
- **Steps:**
  1. `npm install` — installs `openpgp` dependency added in Task 0.3
  2. `npm run build` (`tsc --build`) — all 3 packages compile
  3. `npm test` (`vitest run`) — all tests pass (Phase 0 + 1 + 2 + 3 + 4)
  4. Verify new exports resolve:
     - `node -e "import('@personal-server/core/sync')"`
     - `node -e "import('@personal-server/core/storage/encryption')"`
     - `node -e "import('@personal-server/core/storage/adapters')"`
  5. Start server WITHOUT `VANA_MASTER_KEY_SIGNATURE`:
     - Logs "Sync disabled"
     - `POST /v1/data/test.scope` → returns `status: "stored"`
     - `GET /v1/sync/status` (with owner auth) → `{ enabled: false, ... }`
     - `POST /v1/sync/trigger` (with owner auth) → `{ status: "disabled" }`
  6. Start server WITH `VANA_MASTER_KEY_SIGNATURE` and `sync.enabled: true`:
     - Logs "Sync engine started"
     - `POST /v1/data/test.scope` → returns `status: "syncing"`
     - `GET /v1/sync/status` (with owner auth) → `{ enabled: true, running: true, ... }`

---

## File Inventory (30 file operations)

| Task | File                                                   | New/Modified |
| ---- | ------------------------------------------------------ | ------------ |
| 0.1  | `packages/core/src/sync/types.ts`                      | New          |
| 0.1  | `packages/core/src/sync/index.ts`                      | New          |
| 0.2  | `packages/core/src/schemas/server-config.ts`           | Modified     |
| 0.2  | `packages/core/src/schemas/server-config.test.ts`      | New          |
| 0.2  | `packages/core/src/config/loader.ts`                   | Modified     |
| 0.2  | `packages/core/src/config/index.ts`                    | Modified     |
| 0.3  | `packages/core/src/storage/encryption/encrypt.ts`      | New          |
| 0.3  | `packages/core/src/storage/encryption/decrypt.ts`      | New          |
| 0.3  | `packages/core/src/storage/encryption/index.ts`        | New          |
| 0.3  | `packages/core/src/storage/encryption/encrypt.test.ts` | New          |
| 0.4  | `packages/core/src/storage/adapters/interface.ts`      | New          |
| 0.4  | `packages/core/src/storage/adapters/index.ts`          | New          |
| 0.5  | `packages/core/src/gateway/client.ts`                  | Modified     |
| 0.5  | `packages/core/src/gateway/client.test.ts`             | Modified     |
| 1.1  | `packages/core/src/storage/adapters/vana.ts`           | New          |
| 1.1  | `packages/core/src/storage/adapters/vana.test.ts`      | New          |
| 1.2  | `packages/core/src/storage/index/manager.ts`           | Modified     |
| 1.2  | `packages/core/src/storage/index/manager.test.ts`      | Modified     |
| 1.3  | `packages/core/src/sync/cursor.ts`                     | New          |
| 1.3  | `packages/core/src/sync/cursor.test.ts`                | New          |
| 2.1  | `packages/core/src/sync/workers/upload.ts`             | New          |
| 2.1  | `packages/core/src/sync/workers/upload.test.ts`        | New          |
| 2.2  | `packages/core/src/sync/workers/download.ts`           | New          |
| 2.2  | `packages/core/src/sync/workers/download.test.ts`      | New          |
| 3.1  | `packages/core/src/sync/engine/sync-manager.ts`        | New          |
| 3.1  | `packages/core/src/sync/engine/sync-manager.test.ts`   | New          |
| 3.2  | `packages/server/src/routes/sync.ts`                   | Modified     |
| 3.2  | `packages/server/src/routes/sync.test.ts`              | Modified     |
| 4.1  | `packages/server/src/routes/data.ts`                   | Modified     |
| 4.1  | `packages/server/src/routes/data.test.ts`              | Modified     |
| 4.2  | `packages/server/src/bootstrap.ts`                     | Modified     |
| 4.2  | `packages/server/src/bootstrap.test.ts`                | Modified     |
| 4.2  | `packages/server/src/app.ts`                           | Modified     |
| 4.2  | `packages/server/src/app.test.ts`                      | Modified     |
| 4.2  | `packages/core/package.json`                           | Modified     |

**Unique files: 16 new, 14 modified = 30 distinct files**

---

## Agent Parallelism Strategy

| Batch | Tasks                   | Agents     | Notes                                       |
| ----- | ----------------------- | ---------- | ------------------------------------------- |
| 1     | 0.1, 0.2, 0.3, 0.4, 0.5 | 5 parallel | All independent foundation work             |
| 2     | 1.1, 1.2, 1.3           | 3 parallel | Each extends a different Layer 0 module     |
| 3     | 2.1, 2.2                | 2 parallel | Upload/download workers are independent     |
| 4     | 3.1                     | 1          | SyncManager depends on both workers         |
| 5     | 3.2, 4.1                | 2 parallel | Route changes are independent of each other |
| 6     | 4.2                     | 1          | Integration wiring (touches shared files)   |
| 7     | 5.1                     | 1          | Verification only                           |

---

## Design Notes

- **Upload queue = index entries with `fileId === null`** — No separate queue file or database table. The existing `data_files` SQLite table already has a nullable `fileId` column (Phase 1 design). `findUnsynced()` queries for `file_id IS NULL ORDER BY created_at ASC`. This is crash-safe: if the server dies mid-upload, the entry still has `fileId === null` and will be retried on restart.

- **OpenPGP password-based encryption (vana-sdk format)** — Uses the `openpgp` library to produce standard OpenPGP encrypted messages. The password is `hex(deriveScopeKey(masterKey, scope))` — a per-scope HKDF-derived key hex-encoded as a string. vana-sdk uses the same OpenPGP format but with wallet signature as password; vana-sdk can be updated to accept custom keys for interop. No custom blob serialization format needed — OpenPGP handles its own framing (IV, session key, authentication).

- **`syncManager` is nullable everywhere** — All consumers (`DataRouteDeps`, `SyncRouteDeps`, `ServerContext`) accept `SyncManager | null`. When null, sync is disabled and the server operates in local-only mode identical to Phase 0–3. No feature flags or conditional compilation needed.

- **Download dedup via `findByFileId()`** — Before downloading a file record, the download worker checks if the fileId already exists in the local index. This prevents re-downloading files that were uploaded by this same server instance. `findByFileId` already exists from Phase 2.

- **`getSchema(schemaId)` added to GatewayClient** — Distinct from existing `getSchemaForScope(scope)`. Used during download: the file record has a `schemaId` but no `scope`; we need to resolve `schemaId → scope` to derive the correct scope key for decryption.

- **Master key via `VANA_MASTER_KEY_SIGNATURE` env var** — The EIP-191 signature over `"vana-master-key-v1"` is supplied at startup. The signature bytes ARE the master key material (spec §4.1.6). Scope keys derived via `HKDF-SHA256(masterKey, "vana", "scope:{scope}")` (already implemented in Phase 3 `keys/derive.ts`). Never persisted to disk by the server.

- **`openpgp` library for encryption** — Phase 3 uses `@noble/hashes` for HKDF-SHA256. For file encryption, `openpgp` (v6) provides standard OpenPGP password-based encryption that matches the vana-sdk binary format. This enables cross-tool interop: files encrypted by the personal server can be decrypted by vana-sdk (and vice versa once vana-sdk supports custom key input). The `openpgp` library is well-maintained, audited, and widely used.

- **Sync cursor persisted in `server.json`** — The `lastProcessedTimestamp` is the only recovery checkpoint (spec §4.1.7). File writes are atomic (Phase 1 design). On crash, the server resumes from the last written cursor position and re-processes any in-flight files idempotently.

- **Storage key format: `{scope}/{collectedAt}`** — Deterministic key derived from the data file's scope and collectedAt timestamp. Enables idempotent re-upload (same key = same blob overwritten). Matches the local hierarchy path convention. The adapter prepends `{ownerAddress}/` to form the full R2 key and returns full HTTPS URLs (see `docs/vana-storage-design.md` Sections 4 and 7 for URL format and auth details).

- **Sequential upload processing** — `uploadAll` processes entries sequentially (not parallel) to avoid overwhelming the storage backend and to maintain deterministic ordering. Download similarly processes sequentially. The background loop runs every 60s by default.

- **`saveConfig` writes full config** — To update `sync.lastProcessedTimestamp`, we load the full config, mutate, and write back. This preserves all other fields. Write is atomic via `writeFile` (Node.js guarantees for small files on same filesystem).
