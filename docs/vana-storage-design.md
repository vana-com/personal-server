# Vana Storage & Data Sync Module Design

## 1. Overview & Goals

**Vana Storage** is a hosted encrypted blob storage service at `storage.vana.com`. It serves as the default storage backend for the Vana Data Portability Protocol, enabling encrypted user data to be stored off-device and synced across multiple Personal Server instances.

### Goals

- **Default storage backend** — Zero-config option for users who don't bring their own storage (GDrive, Dropbox, IPFS)
- **Encrypted-only** — All blobs are pre-encrypted by the Personal Server before upload; Vana Storage never sees plaintext
- **Multi-tenant** — Single deployment serves all users, with auth-enforced isolation
- **Protocol-aligned** — URL format mirrors the local data hierarchy; integrates with DataRegistry via Gateway
- **Extensible** — StorageAdapter interface allows swapping in GDrive/Dropbox/IPFS without changing the sync engine

### Non-Goals

- Decrypting or processing data (Vana Storage is a dumb blob store)
- File discovery or querying (handled by Gateway's DataRegistry)
- Schema validation (done by Personal Server before upload)
- User account management (handled by the protocol layer)

### Relationship to Phase 4

This doc supplements `docs/260129-phase-4-implementation-plan.md`. Phase 4 defines the sync engine (encryption, upload/download workers, SyncManager). This doc defines:

- The real Vana Storage service (replacing Phase 4's placeholder REST API)
- Delta updates to Phase 4's StorageAdapter for the real API
- Multi-backend extensibility design

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Personal Server (Desktop / ODL Cloud / Self-Hosted)                 │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Sync Engine (Phase 4)                                         │  │
│  │  ├── Upload Worker: read local → encrypt → PUT storage → register Gateway │
│  │  ├── Download Worker: poll Gateway → GET storage → decrypt → write local  │
│  │  └── SyncManager: background loop, crash recovery              │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  StorageAdapter Interface                                      │  │
│  │  ├── VanaStorageAdapter (this doc)                             │  │
│  │  ├── GDriveAdapter (future)                                    │  │
│  │  ├── DropboxAdapter (future)                                   │  │
│  │  └── IPFSAdapter (future)                                      │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
          │                                      │
          │ PUT/GET/DELETE/HEAD                  │ registerFile / listFilesSince
          │ (Web3Signed auth)                    │ (DP RPC)
          ▼                                      ▼
┌──────────────────────┐               ┌──────────────────────┐
│  Vana Storage         │              │  Gateway (DP RPC)    │
│  storage.vana.com     │              │  rpc.vana.org        │
│                       │              │                      │
│  CF Worker + R2       │              │  Vercel (Serverless) │
│  ├── Auth (Web3Signed)│              │  ├── DataRegistry    │
│  ├── Blob CRUD        │              │  ├── File Records    │
│  ├── Usage Tracking   │              │  └── Schema Registry │
│  └── Rate Limiting    │              └──────────────────────┘
└──────────────────────┘
```

### Data Flow: Upload

1. Personal Server ingests data → stores locally unencrypted
2. Sync engine picks up unsynced entry (`fileId IS NULL`)
3. Reads local file, derives scope key via HKDF, encrypts with OpenPGP
4. `PUT https://storage.vana.com/v1/blobs/{ownerAddress}/{scope}/{collectedAt}` (Web3Signed, scope in dot notation)
5. Storage returns `200 OK` with `ETag`
6. Personal Server registers file with Gateway: `POST gateway/v1/files` with URL `https://storage.vana.com/v1/blobs/{ownerAddress}/{scope}/{collectedAt}`
7. Gateway returns `fileId`
8. Personal Server updates local index with `fileId`

### Data Flow: Download (sync to another Personal Server)

1. Personal Server polls Gateway: `GET gateway/v1/files?owner={owner}&since={cursor}`
2. For each new file record: extract URL from record
3. `GET https://storage.vana.com/v1/blobs/{ownerAddress}/{scope}/{collectedAt}` (Web3Signed)
4. Resolve `schemaId → scope` via Gateway
5. Derive scope key, decrypt with OpenPGP
6. Write to local hierarchy, update index with `fileId`
7. Advance cursor

---

## 3. Vana Storage API Spec

**Base URL:** `https://storage.vana.com`

### Authentication

All endpoints (except `/health`) require `Authorization: Web3Signed <base64url(payload)>.<signature>` header.

The Worker verifies:

1. Signature is valid (EIP-191 recovery)
2. `aud` claim matches `https://storage.vana.com`
3. `method` and `uri` claims match the request
4. `bodyHash` matches SHA-256 of the request body (integrity check)
5. `iat`/`exp` time bounds are valid (300s clock skew tolerance)
6. Recovered signer is authorized for `{ownerAddress}` (see Auth Flow, Section 5)

**Web3Signed Payload Schema:**

```json
{
  "aud": "https://storage.vana.com",
  "method": "PUT",
  "uri": "/v1/blobs/0xAbC.../instagram.profile/2026-01-21T10-00-00Z",
  "bodyHash": "sha256:abcdef...",
  "iat": 1706000000,
  "exp": 1706000300
}
```

| Field      | Type   | Description                                                                               |
| ---------- | ------ | ----------------------------------------------------------------------------------------- |
| `aud`      | string | Audience — must be `https://storage.vana.com`                                             |
| `method`   | string | HTTP method (GET, PUT, DELETE, HEAD)                                                      |
| `uri`      | string | Request path (including query params if any)                                              |
| `bodyHash` | string | `sha256:{hex}` of request body, or `sha256:e3b0c44...` (empty hash) for bodiless requests |
| `iat`      | number | Issued-at timestamp (seconds since epoch)                                                 |
| `exp`      | number | Expiration timestamp (seconds since epoch)                                                |

**Authorization model:** The signer may be either:

- **The owner directly** (e.g., from Desktop App) → signer === ownerAddress → authorized
- **A Personal Server** (signs with server keypair) → Worker checks Gateway attestation (see Section 5)

### Endpoints

#### `PUT /v1/blobs/{ownerAddress}/{scope}/{collectedAt}`

Upload an encrypted blob.

- **Auth:** Web3Signed (signer must be authorized for `ownerAddress`)
- **Request Body:** Raw encrypted bytes (`application/octet-stream`)
- **Request Headers:**
  - `Content-Type: application/octet-stream`
  - `Content-Length: <bytes>`
- **Behavior:** Idempotent — same key overwrites existing blob
- **Max body size:** 100MB (configurable)
- **Response (200 OK):**
  ```json
  {
    "key": "{ownerAddress}/{scope}/{collectedAt}",
    "url": "https://storage.vana.com/v1/blobs/{ownerAddress}/{scope}/{collectedAt}",
    "etag": "\"abc123\"",
    "size": 12345
  }
  ```
- **Response (413 Payload Too Large):**
  ```json
  {
    "error": "PAYLOAD_TOO_LARGE",
    "message": "Max blob size is 100MB",
    "maxBytes": 104857600
  }
  ```

**Note:** `scope` in the URL uses dot notation as-is (e.g., `instagram.profile`). No path conversion needed. The full path for a blob would be:

```
/v1/blobs/0xAbC.../instagram.profile/2026-01-21T10-00-00Z
```

#### `GET /v1/blobs/{ownerAddress}/{scope}/{collectedAt}`

Download an encrypted blob.

- **Auth:** Web3Signed
- **Response Headers:**
  - `Content-Type: application/octet-stream`
  - `Content-Length: <bytes>`
  - `ETag: "<hash>"`
  - `Last-Modified: <RFC 2822>`
- **Conditional Request:** Supports `If-None-Match` → `304 Not Modified`
- **Response (200 OK):** Raw encrypted bytes
- **Response (404 Not Found):**
  ```json
  { "error": "NOT_FOUND", "message": "Blob not found" }
  ```

#### `DELETE /v1/blobs/{ownerAddress}/{scope}/{collectedAt}`

Delete a single blob.

- **Auth:** Web3Signed
- **Response (200 OK):**
  ```json
  { "deleted": true, "key": "{ownerAddress}/{scope}/{collectedAt}" }
  ```
- **Response (404 Not Found):**
  ```json
  { "error": "NOT_FOUND", "message": "Blob not found" }
  ```

#### `DELETE /v1/blobs/{ownerAddress}/{scope}`

Bulk delete all blobs for a scope. Used when a user deletes a data scope from their Personal Server.

- **Auth:** Web3Signed
- **Response (200 OK):**
  ```json
  { "deleted": true, "scope": "{scope}", "count": 42 }
  ```

#### `DELETE /v1/blobs/{ownerAddress}`

Delete all blobs for a user. Used for account deletion.

- **Auth:** Web3Signed
- **Response (200 OK):**
  ```json
  { "deleted": true, "ownerAddress": "{ownerAddress}", "count": 1337 }
  ```

#### `HEAD /v1/blobs/{ownerAddress}/{scope}/{collectedAt}`

Check blob existence and metadata without downloading.

- **Auth:** Web3Signed
- **Response (200 OK):** No body. Headers: `Content-Length`, `ETag`, `Last-Modified`
- **Response (404 Not Found):** No body.

#### `GET /v1/usage/{ownerAddress}`

Get usage statistics for a user. For tracking and future quota enforcement.

- **Auth:** Web3Signed (signer must be authorized for `ownerAddress`)
- **Response (200 OK):**
  ```json
  {
    "ownerAddress": "0xAbC...",
    "totalBytes": 52428800,
    "blobCount": 127,
    "updatedAt": "2026-01-21T10:00:00Z"
  }
  ```

**Implementation note:** Usage stats are maintained by the Worker using a Cloudflare Durable Object or KV counter that increments/decrements on PUT/DELETE. Not real-time R2 enumeration (too expensive).

#### `GET /health`

Health check. No auth required.

- **Response (200 OK):**
  ```json
  { "status": "ok", "service": "vana-storage", "version": "1.0.0" }
  ```

### Rate Limiting

Rate limits enforced per `ownerAddress` using Cloudflare's built-in rate limiting or a Worker-side token bucket.

| Endpoint       | Limit                 |
| -------------- | --------------------- |
| PUT (upload)   | 60 req/min per owner  |
| GET (download) | 300 req/min per owner |
| DELETE         | 30 req/min per owner  |
| HEAD           | 300 req/min per owner |

Response headers on every request:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1706000000
```

Rate limit exceeded → `429 Too Many Requests`:

```json
{ "error": "RATE_LIMITED", "message": "Rate limit exceeded", "retryAfter": 30 }
```

### CORS

CORS headers included for browser-based access (e.g., Desktop App using fetch):

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, PUT, DELETE, HEAD, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Expose-Headers: ETag, Content-Length, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
```

### Error Response Format

All errors follow a consistent JSON format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description"
}
```

| Code                | HTTP Status | Meaning                              |
| ------------------- | ----------- | ------------------------------------ |
| `AUTH_REQUIRED`     | 401         | Missing Authorization header         |
| `AUTH_INVALID`      | 401         | Invalid signature or expired         |
| `FORBIDDEN`         | 403         | Signer not authorized for this owner |
| `NOT_FOUND`         | 404         | Blob not found                       |
| `PAYLOAD_TOO_LARGE` | 413         | Blob exceeds max size                |
| `RATE_LIMITED`      | 429         | Rate limit exceeded                  |
| `INTERNAL_ERROR`    | 500         | Unexpected server error              |

---

## 4. Data Model & Key Schema

### R2 Key Structure

Single R2 bucket. Keys use dot-notation scope (no path conversion):

```
{ownerAddress}/{scope}/{collectedAt}
```

Examples:

```
0xAbCdEf.../instagram.profile/2026-01-21T10-00-00Z
0xAbCdEf.../chatgpt.conversations/2026-01-22T10-00-00Z
0xAbCdEf.../youtube.watch_history/2026-01-21T10-00-00Z
```

### Why This Key Structure

- **Simplicity** — Scope stays in dot notation everywhere (local index, URLs, R2 keys). No conversion logic.
- **Debugging** — Easy to map between local files and remote blobs (same scope string)
- **Bulk operations** — R2 list-by-prefix enables efficient scope-level deletes (`DELETE /v1/blobs/{owner}/{scope}`)
- **Three-level hierarchy** — `{owner}/{scope}/{timestamp}` is flat enough to avoid deep nesting issues

### R2 Object Metadata

Each R2 object stores custom metadata:

| Field            | Value                  | Purpose                                                   |
| ---------------- | ---------------------- | --------------------------------------------------------- |
| `x-owner`        | `0xAbC...`             | Owner address (redundant with key prefix, for validation) |
| `x-scope`        | `instagram.profile`    | Original dot-notation scope                               |
| `x-collected-at` | `2026-01-21T10:00:00Z` | Collection timestamp (canonical ISO 8601)                 |
| `x-uploaded-at`  | `2026-02-01T12:00:00Z` | Upload timestamp                                          |
| `x-content-hash` | `sha256:abcdef...`     | SHA-256 of encrypted blob (integrity check)               |

### URL Mapping

The canonical URL stored in DataRegistry is the HTTPS URL:

```
https://storage.vana.com/v1/blobs/{ownerAddress}/{scope}/{collectedAt}
```

The `VanaStorageAdapter` in the Personal Server maps between this URL and R2 operations. Other adapters (GDrive, Dropbox, IPFS) will use their own URL schemes:

| Backend      | URL Format                                               | Example                                                                            |
| ------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Vana Storage | `https://storage.vana.com/v1/blobs/{owner}/{scope}/{ts}` | `https://storage.vana.com/v1/blobs/0xAb.../instagram.profile/2026-01-21T10-00-00Z` |
| Google Drive | `gdrive://{fileId}`                                      | `gdrive://1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs`                                       |
| Dropbox      | `dropbox://{path}`                                       | `dropbox:///vana/0xAb.../instagram/profile/2026-01-21.enc`                         |
| IPFS         | `ipfs://{cid}`                                           | `ipfs://QmTzQ1JRkWErjk39mryYw2WVaphAZNAREyMchXzYQ7c9v3`                            |

---

## 5. Auth Flow

### Web3Signed Verification in the Worker

The Vana Storage Worker reuses the same `Web3Signed` auth scheme as the Personal Server. The key difference: the signer is the Personal Server's keypair, not the user's wallet. The Worker must verify the server is authorized to act on behalf of the owner.

```
┌────────────────────┐     Web3Signed      ┌────────────────────┐
│  Personal Server   │ ─────────────────→  │  Vana Storage      │
│  (signs with       │                     │  (CF Worker)       │
│   server keypair)  │                     │                    │
└────────────────────┘                     └────────┬───────────┘
                                                     │
                                                     │ Is server 0xSrv...
                                                     │ authorized for
                                                     │ owner 0xOwn...?
                                                     ▼
                                            ┌────────────────────┐
                                            │  Gateway (DP RPC)  │
                                            │  GET /v1/servers/  │
                                            │  {serverAddress}   │
                                            └────────────────────┘
```

### Verification Steps

1. Parse `Authorization: Web3Signed {base64url(payload)}.{signature}`
2. Decode payload → verify `aud`, `method`, `uri`, `bodyHash`, `iat`, `exp`
3. Recover signer address from EIP-191 signature
4. Extract `{ownerAddress}` from URL path
5. **If signer === ownerAddress** → authorized (direct owner access, skip step 6)
6. **Authorization check (server delegation):** Query Gateway to verify signer is a registered server for the owner:
   - `GET {gateway}/v1/servers/{signerAddress}`
   - Response: `{ data: { ownerAddress, serverAddress, publicKey, serverUrl, addedAt }, proof: { ... } }`
   - Verify `data.ownerAddress === {ownerAddress}` from the URL path
   - Cache result in Worker memory or CF KV (TTL: 5 minutes)
7. If all checks pass → proceed with R2 operation
8. If any check fails → return 401 or 403

**Gateway server endpoint (confirmed):** `GET https://data-gateway-env-dev-opendatalabs.vercel.app/v1/servers/{serverAddress}` — returns server registration including `ownerAddress`. This is used by the Storage Worker to verify server-to-owner authorization.

### Caching Strategy

Gateway attestation results are cached to avoid per-request Gateway calls:

- **Cache key:** `auth:{signerAddress}:{ownerAddress}`
- **Cache TTL:** 5 minutes (balances freshness vs. performance)
- **Cache store:** Worker in-memory (per-isolate) or Cloudflare KV
- **Cache invalidation:** TTL-based only (server deregistration takes effect within 5 min)

### Owner Direct Access

Users accessing Vana Storage directly (e.g., from Desktop App) sign with their own wallet. In this case, the signer IS the owner — no Gateway check needed.

---

## 6. Usage Tracking & Rate Limiting

### Usage Tracking

Usage metrics are tracked per owner for monitoring and future quota enforcement. No hard limits enforced initially.

**Tracked metrics:**

- Total bytes stored
- Blob count
- Last upload timestamp
- Total bandwidth (upload + download bytes)

**Implementation:** Cloudflare Durable Object per owner, or KV counters with atomic increment:

```
KV key: usage:{ownerAddress}
KV value: { totalBytes, blobCount, lastUpload, bandwidthBytes }
```

Updated atomically on PUT (increment) and DELETE (decrement). GET/HEAD increment bandwidth counter only.

### Future Quota Enforcement

When quotas are needed, the Worker checks usage before allowing uploads:

```
if (currentUsage.totalBytes + requestSize > quotaLimit) {
  return 413 QUOTA_EXCEEDED
}
```

Quota tiers can be defined in KV or a config table. Design leaves room for this without current implementation.

### Rate Limiting

See Section 3 for rate limit values. Implementation uses CF Rate Limiting rules or a Worker-side sliding window counter in KV.

---

## 7. Storage Adapter Updates (Delta to Phase 4)

The Phase 4 plan (`docs/260129-phase-4-implementation-plan.md`) defines a placeholder `VanaStorageAdapter` in Task 1.1. This section describes the changes needed for the real Vana Storage API.

### Interface Changes

The `StorageAdapter` interface (Phase 4, Task 0.4) remains unchanged:

```typescript
interface StorageAdapter {
  upload(key: string, data: Uint8Array): Promise<string>;
  download(url: string): Promise<Uint8Array>;
  delete(url: string): Promise<boolean>;
  exists(url: string): Promise<boolean>;
}
```

### VanaStorageAdapter Changes (Task 1.1 Delta)

**Key format change:** Phase 4 uses `encodeURIComponent(key)` as a flat blob key. Real API uses `{ownerAddress}/{scope}/{collectedAt}` with scope in dot notation (no conversion needed).

```typescript
// Phase 4 placeholder:
blobUrl(key) → `${base}/v1/blobs/${encodeURIComponent(key)}`

// Real API:
blobUrl(key) → `${base}/v1/blobs/${ownerAddress}/${key}`
// Where key = `${scope}/${collectedAt}` (scope stays in dot notation)
```

**No scope conversion needed:** The upload worker passes `storageKey = entry.scope + "/" + entry.collectedAt` (Phase 4, Task 2.1, step 7). Since dots are kept as-is in URLs, no conversion is needed:

```typescript
// upload() key transformation:
// Input key: "instagram.profile/2026-01-21T10-00-00Z"
// R2 key: "{ownerAddress}/instagram.profile/2026-01-21T10-00-00Z"
// URL: "https://storage.vana.com/v1/blobs/{ownerAddress}/instagram.profile/2026-01-21T10-00-00Z"
```

**URL parsing:** `download()`, `delete()`, `exists()` receive the full HTTPS URL from DataRegistry. Parse the path after `/v1/blobs/`:

```typescript
// Input URL: "https://storage.vana.com/v1/blobs/0xAb.../instagram.profile/2026-01-21T10-00-00Z"
// Extract path after /v1/blobs/ → "0xAb.../instagram.profile/2026-01-21T10-00-00Z"
```

**Auth header:** Phase 4 placeholder has no auth. Real adapter must sign requests with Web3Signed:

```typescript
export interface VanaStorageOptions {
  apiUrl: string;
  ownerAddress: string;
  signer: ServerSigner; // NEW: for Web3Signed auth
}
```

The adapter calls `signer.signRequest({ aud, method, uri, bodyHash })` to produce the `Authorization` header for each request.

### New Adapter Methods

Add bulk delete support to the interface for scope/user deletion:

```typescript
interface StorageAdapter {
  // ... existing 4 methods ...
  deleteScope?(scope: string): Promise<number>; // Returns count deleted. Optional — not all backends support bulk delete.
  deleteAll?(): Promise<number>; // Returns count deleted. Optional.
}
```

Vana Storage and Dropbox implement these. IPFS cannot delete. GDrive needs folder-level logic. Optional methods (`?`) allow graceful degradation — the sync engine checks for support before calling.

### Delete Flow: Storage + DataRegistry

When blobs are deleted from Vana Storage, the corresponding DataRegistry file records should also be cleaned up. This is the **Personal Server's responsibility**, not the Storage Worker's:

1. User triggers `DELETE /v1/data/{scope}` on their Personal Server
2. Personal Server deletes local files + index entries
3. Personal Server calls `storageAdapter.deleteScope(scope)` to remove blobs from Vana Storage
4. Personal Server calls Gateway to deregister file records: `DELETE {gateway}/v1/files?owner={owner}&scope={scope}` (or individual `DELETE {gateway}/v1/files/{fileId}` per record)
5. Other Personal Server instances pick up the deletion on next sync poll (Gateway returns tombstone / absence of fileId)

**Note:** The Gateway deregistration API (`DELETE /v1/files/...`) may need to be built. This is captured in Open Questions.

### Upload Worker Changes (Task 2.1 Delta)

No key format changes needed — Phase 4's `storageKey = entry.scope + "/" + entry.collectedAt` already produces the correct format since scope stays in dot notation.

The returned URL from `storageAdapter.upload()` is the full HTTPS URL, which is registered with Gateway as-is.

---

## 8. Multi-Backend Extensibility

### Design Principle

The `StorageAdapter` interface is the extension point. Each backend implements the same 4 core methods. Backend-specific behavior (auth, URL schemes, content addressing) is encapsulated inside the adapter.

### Backend Configuration

Backend selection is per-user, stored in `server.json`:

```json
{
  "storage": {
    "backend": "vana",
    "config": {
      "vana": { "apiUrl": "https://storage.vana.com" },
      "gdrive": { "folderId": "..." },
      "dropbox": { "basePath": "/vana" },
      "ipfs": { "gateway": "https://ipfs.io", "pinService": "..." }
    },
    "oauth": {
      "gdrive": {
        "accessToken": "...",
        "refreshToken": "...",
        "expiresAt": "..."
      },
      "dropbox": {
        "accessToken": "...",
        "refreshToken": "...",
        "expiresAt": "..."
      }
    }
  }
}
```

### Factory Function

A factory creates the appropriate adapter from config:

```typescript
function createStorageAdapter(
  config: StorageConfig,
  ownerAddress: string,
  signer: ServerSigner,
): StorageAdapter {
  switch (config.backend) {
    case "vana":
      return createVanaStorageAdapter({
        apiUrl: config.config.vana.apiUrl,
        ownerAddress,
        signer,
      });
    case "gdrive":
      return createGDriveAdapter({
        ...config.config.gdrive,
        oauth: config.oauth.gdrive,
      });
    case "dropbox":
      return createDropboxAdapter({
        ...config.config.dropbox,
        oauth: config.oauth.dropbox,
      });
    case "ipfs":
      return createIPFSAdapter(config.config.ipfs);
    case "local":
      throw new Error(
        "Local backend does not use StorageAdapter (sync disabled)",
      );
  }
}
```

### Backend-Specific Considerations

| Backend      | Key Structure                | Delete Support        | Auth          | Notes                             |
| ------------ | ---------------------------- | --------------------- | ------------- | --------------------------------- |
| Vana Storage | Hierarchical (mirrors local) | Full (single + bulk)  | Web3Signed    | Default, zero-config              |
| Google Drive | Flat (GDrive assigns fileId) | Single only           | OAuth 2.0     | Needs folder structure management |
| Dropbox      | Hierarchical (matches local) | Full                  | OAuth 2.0     | Natural path mapping              |
| IPFS         | Content-addressed (CID)      | No delete (immutable) | None (public) | Pin management needed             |

### Migration Between Backends

When a user switches backends:

1. Desktop App triggers bulk migration via Personal Server
2. Personal Server downloads all blobs from old backend
3. Uploads to new backend
4. Re-registers file records in DataRegistry with new URLs
5. Optionally deletes from old backend

This is a future feature — not in scope for v1.

---

## 9. Deployment & Operations

### Infrastructure

| Component      | Provider                         | Notes                                |
| -------------- | -------------------------------- | ------------------------------------ |
| Worker         | Cloudflare Workers               | Handles auth, routing, rate limiting |
| Blob Storage   | Cloudflare R2                    | Single bucket, hierarchical keys     |
| Usage Counters | Cloudflare KV or Durable Objects | Per-owner usage tracking             |
| Auth Cache     | Worker memory + KV               | Gateway attestation cache            |
| Domain         | `storage.vana.com`               | Custom domain on CF Workers          |

### R2 Bucket Configuration

- **Bucket name:** `vana-storage-prod` (or `vana-storage-dev` for staging)
- **Region:** Auto (Cloudflare picks optimal)
- **Lifecycle rules:** None (data persists until explicitly deleted)
- **No public access** — All access through the Worker

### Monitoring

- **Cloudflare Analytics** — Request counts, error rates, latency
- **Usage dashboard** — Per-owner storage consumption (from KV counters)
- **Alerts** — Error rate spikes, R2 storage growth rate

### Cost Considerations

R2 pricing (no egress fees):

- Storage: $0.015/GB/month
- Class A operations (PUT, DELETE): $4.50/million
- Class B operations (GET, HEAD): $0.36/million

For 10K users averaging 50MB each = 500GB → ~$7.50/month storage + operations.

---

### collectedAt Format Decision

URLs and R2 keys use the **filesystem-safe format**: `2026-01-21T10-00-00Z` (hyphens instead of colons). This matches the local file hierarchy and avoids URL-encoding issues. R2 object metadata (`x-collected-at`) stores the canonical ISO 8601 format with colons (`2026-01-21T10:00:00Z`) for consistency with the protocol spec.

---

## 10. Open Questions

1. ~~**Gateway attestation endpoint**~~ — **Resolved.** `GET /v1/servers/{serverAddress}` exists and returns `{ data: { ownerAddress, serverAddress, ... } }`. No new Gateway work needed for auth.

2. **Gateway file deregistration** — `DELETE /v1/files/{fileId}` does not exist on the Gateway yet. Needed for the delete flow (Section 7). **Deferred** — delete from storage works without Gateway deregistration; registry cleanup will be addressed in a future phase.

3. **Blob size limits** — 100MB suggested. Is this sufficient for all data types? Large exports (e.g., full email archives) might exceed this.

4. **Encryption format versioning** — Should R2 object metadata include the encryption format version (e.g., `x-encryption: openpgp-v6-password`) to support future encryption scheme changes?

5. **Bulk upload on backend switch** — When a user selects Vana Storage for the first time with existing local data, how is the initial bulk upload triggered? Desktop App API call?

6. **R2 bucket per environment** — Separate buckets for dev/staging/prod, or one bucket with environment prefixes?

7. **Rate limit values** — The suggested limits (60 PUT/min, 300 GET/min) are initial guesses. Should these be validated against expected usage patterns?
