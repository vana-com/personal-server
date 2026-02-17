# DataConnect (DataBridge) Integration Refactor — Implementation Guide

## Context

The personal-server-ts repo has been refactored to support:

- **IPC transport** (Unix domain socket) for admin/owner operations
- **Dynamic tunnel proxy naming** (no more wrapper hacks)
- **Local-only middleware** (tunnel can't reach ingest routes)
- **Runtime package** with process supervisor, daemonization, PID file discovery
- **Admin app** serving grant CRUD, data ingest/delete, access logs, sync — all over IPC

DataConnect currently uses `pkg` to compile personal-server-ts into a standalone binary, then patches around its limitations with native module copying, proxy name rewrites, and custom route injection. This guide covers every change needed to adopt the new architecture.

---

## 1. Replace pkg with Node.js + npm Package

### Why pkg must go

`pkg` (@yao-pkg/pkg) compiles personal-server into a ~65MB binary, but it's **not actually standalone** — it still requires `node_modules/` alongside it for better-sqlite3 (native `.node` addon). This means pkg's core value proposition (single binary distribution) was never realized. All three alternatives evaluated (pkg, Node.js binary, Node SEA) end up at roughly the same on-disk size (~60-85MB) since they all embed a Node.js runtime.

| Factor           | pkg (current)                           | Node.js binary (recommended)  | Node SEA                        |
| ---------------- | --------------------------------------- | ----------------------------- | ------------------------------- |
| On-disk size     | ~60-80 MB                               | ~65-85 MB                     | ~55-75 MB                       |
| Build complexity | High (esbuild→pkg→copy→download)        | **Low (npm ci + copy)**       | High (bundle→blob→inject→sign)  |
| Native modules   | `eval('require')` hacks                 | **Standard npm resolution**   | Temp file extraction at runtime |
| Code signing     | Sign binary + each .node + re-sign .app | **Sign Node binary once**     | Remove sig, inject, re-sign     |
| Debugging        | Poor (V8 snapshot, no source maps)      | **Excellent (stock Node.js)** | Poor (bundled blob)             |
| Maintenance risk | Community fork of abandoned project     | **Stock Node.js**             | Stability 1.1 (not stable)      |
| Dev experience   | Slow rebuild cycle                      | **`tsx watch`, no packaging** | Slow rebuild cycle              |

**SEA is not ready:** Node 22 SEA can embed assets, but native `.node` files must be extracted to temp directories at runtime. This introduces antivirus false positives, permission issues, and race conditions. SEA is stability level 1.1 (Active Development), not production-ready.

**Future path:** Node.js has a built-in `node:sqlite` module (stability 1.1). When it stabilizes, better-sqlite3 can be replaced, eliminating the native addon entirely. At that point SEA becomes viable for true single-binary deployment. This is a 6-12 month horizon.

### Current build pipeline (to delete)

### Current build pipeline (to delete)

```
esbuild (with eval('require') plugins)
    → pkg (embeds Node 22 + bundle)
        → copy native modules (better-sqlite3, bindings, file-uri-to-path)
            → download prebuilt better-sqlite3 for pkg's Node version
```

**Files:**

- `personal-server/scripts/build.js` — esbuild plugins + pkg invocation + native module copy
  - `dynamicNativeRequirePlugin` (line 119-135): replaces `require('better-sqlite3')` with `eval('require')('better-sqlite3')` to hide from pkg
  - `inlinePackageJsonPlugin` (line 141-162): inlines package.json files at build time
  - Native module copy loop (line 194-204): `['better-sqlite3', 'bindings', 'file-uri-to-path']`
  - Prebuilt download (line 209-220): `npx prebuild-install -r node -t ${pkgNodeMajor}.0.0`
- `personal-server/index.cjs` — CJS entry point required by pkg (pkg doesn't support ESM entry)
- `scripts/ensure-personal-server.js` — staleness checker that triggers rebuild when source changes
- `scripts/build-prod.js`:
  - line 88-94: `npm install && npm run build` in personal-server dir
  - line 45-58: `copyNativeModulesIntoApp()` — copies `dist/node_modules` into `.app/Contents/Resources`
- `personal-server/package.json` — `pkg.assets` and `pkg.targets` config (lines 12-27)

### Target: Ship Node.js binary + personal-server-ts as normal npm package

**New Tauri resource layout:**

```
Resources/
├── node                          # Node.js 22 binary (~50MB)
└── personal-server/
    ├── index.js                  # Thin entry point (ESM)
    ├── package.json
    └── node_modules/             # Normal npm install output
        ├── @opendatalabs/...
        ├── better-sqlite3/       # Native addon, resolved normally
        └── ...
```

**Changes to `src-tauri/tauri.conf.json`:**

Current resource config (line 65):

```json
"../personal-server/dist/personal-server*": "personal-server/dist/"
```

New:

```json
"../personal-server/": "personal-server/",
"../node/node": "node/"
```

**Changes to `src-tauri/src/commands/server.rs`:**

Current binary resolution (lines 32-39):

```rust
let candidates = [
    resource_dir.join("personal-server").join("dist").join(binary_name),
    resource_dir.join("binaries").join(binary_name),
    resource_dir.join("_up_").join("personal-server").join("dist").join(binary_name),
];
```

Current node_modules check (lines 48-55):

```rust
let dist_dir = candidate.parent().unwrap_or(candidate);
if !dist_dir.join("node_modules").exists() {
    log::warn!("Skipping {:?}: node_modules/ not found alongside binary", candidate);
    continue;
}
```

New approach:

```rust
// Production: run bundled Node.js with personal-server entry point
let node_binary = resource_dir.join("node").join("node");
let entry_script = resource_dir.join("personal-server").join("index.js");

// Dev mode fallback: use system Node
let (cmd, args) = if node_binary.exists() && entry_script.exists() {
    (node_binary, vec![entry_script])
} else {
    // Development: node from PATH
    ("node".into(), vec![dev_personal_server_path.join("index.js")])
};
```

Delete the codesign block (lines 163-177) — only need to sign the Node binary once during release, not per-launch.

**Changes to `.github/workflows/release.yml`:**

Delete:

- Personal-server pkg build steps (lines 114-127)
- All `.node` file signing (lines 183-188)
- `node_modules` copy into `.app` (lines 202-203)
- `.app` re-signing after modification (lines 214-221)
- DMG `node_modules` verification (lines 243)
- Linux AppImage extract/repack for `node_modules` (lines 294-313)

Add:

- Download Node.js 22 binary for target platform from nodejs.org
- Place in release resources alongside personal-server folder

**Files to delete entirely:**

- `personal-server/scripts/build.js`
- `personal-server/index.cjs`
- `scripts/ensure-personal-server.js`

---

## 2. Eliminate the Wrapper Entirely

### Current wrapper (`personal-server/index.js`)

The wrapper currently:

1. Imports `createServer` from personal-server-ts packages (line 111-112) — **now in index.ts**
2. Adds custom `DELETE /v1/grants/:grantId` route (lines 120-151) — **now in admin-app.ts**
3. Adds custom `GET /status` route (lines 154-158) — **now in health.ts**
4. Calls `startBackgroundServices()` (line 176) — **now in index.ts**
5. Rewrites tunnel proxy name via `fixTunnelProxyName()` (lines 35-85) — **now native via `deriveProxyName()`**
6. Emits JSON-line stdout messages for Tauri to parse (lines 26-28, 163, 166-170, 202, 204, 219) — **no longer needed**

All 6 responsibilities are now handled natively. **No changes to personal-server-ts are required** to eliminate the wrapper.

### Why stdout messages are no longer needed

The current stdout JSON-line protocol (`ready`, `tunnel`, `dev-token`, `error`, `log`) was the only remaining reason for the wrapper. Each message now has a better alternative:

| Current stdout message         | Replacement                                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `{ type: "ready", port }`      | Poll PID file at `{storageRoot}/server.json` — written after HTTP+IPC are up. Contains `{ pid, port, socketPath, version, startedAt }` |
| `{ type: "tunnel", url }`      | `GET /health` returns tunnel URL when available                                                                                        |
| `{ type: "dev-token", token }` | Eliminated — devToken auth replaced by IPC socket permissions                                                                          |
| `{ type: "error", message }`   | Process exit code + `daemon.log` in storageRoot                                                                                        |
| `{ type: "tunnel-failed" }`    | Absence of tunnel info in `GET /health` response                                                                                       |
| `{ type: "log", message }`     | pino logs to stdout/`daemon.log` — no special parsing needed                                                                           |

### What to delete in DataConnect

**Delete entirely:**

- `personal-server/index.js`
- `personal-server/index.cjs`
- `personal-server/scripts/build.js`
- `personal-server/package.json` (or repurpose as thin dependency spec with only `@opendatalabs/personal-server-ts` dependency)

### What changes in `server.rs`

**Replace stdout JSON parsing with PID file polling:**

Current (lines 281-338): Reads stdout line-by-line, parses JSON, emits Tauri events.

New: After spawning the Node process, poll for PID file appearance:

```rust
// Spawn process
let child = Command::new(&node_binary)
    .args([&entry_script])
    .envs(env_vars)
    .spawn()?;

// Poll PID file for readiness (replaces stdout "ready" message)
let pid_file = storage_root.join("server.json");
let metadata = poll_for_file(&pid_file, Duration::from_secs(30))?;
// metadata contains: { pid, port, socketPath, version, startedAt }

// Emit readiness event with port from PID file
app_handle.emit("personal-server-ready", json!({ "port": metadata.port }));

// Tunnel URL: poll GET /status periodically or on-demand
// Returns: { status: "running", owner: string | null, port: number }
```

**Delete:** The entire stdout reader thread and JSON message parsing (lines 281-338), the `send()` function pattern, and the `dev-token` event handling.

---

## 3. Switch Admin Calls from HTTP to IPC

### Current HTTP calls

**`src/services/personalServer.ts`:**

All calls go through `serverFetch()` (lines 39-82) which uses `@tauri-apps/plugin-http` to make HTTP requests to `localhost:${port}`.

| Function                   | Method | URL                     | Auth                 |
| -------------------------- | ------ | ----------------------- | -------------------- |
| `createGrant()` (line 84)  | POST   | `/v1/grants`            | `Bearer ${devToken}` |
| `listGrants()` (line 102)  | GET    | `/v1/grants`            | `Bearer ${devToken}` |
| `revokeGrant()` (line 122) | DELETE | `/v1/grants/${grantId}` | none                 |

**`src/services/personalServerIngest.ts`:**

| Function                 | Method | URL                 | Auth |
| ------------------------ | ------ | ------------------- | ---- |
| `ingestData()` (line 13) | POST   | `/v1/data/${scope}` | none |

### New IPC calls

The admin app on IPC serves the same endpoints but with **no auth required** — socket file permissions (chmod 0600) enforce the trust boundary.

**New client approach — two options:**

**Option A: Use `IpcClient` from personal-server-ts runtime package**

The `IpcClient` class (`packages/runtime/src/ipc-client.ts`) sends HTTP requests over a Unix domain socket:

```typescript
import { IpcClient, readPidFile } from "@opendatalabs/personal-server-ts";

// Discover socket path from PID file
const metadata = await readPidFile(storageRoot);
// metadata = { pid, port, socketPath, version, startedAt }

const client = new IpcClient({ storageRoot });

// Create grant
const res = await client.post("/v1/grants", {
  granteeAddress: "0x...",
  scopes: ["chatgpt.conversations"],
  expiresAt: Math.floor(Date.now() / 1000) + 86400,
});
const { grantId } = IpcClient.parseJson(res);

// List grants
const res = await client.get("/v1/grants");
const { grants } = IpcClient.parseJson(res);

// Revoke grant
await client.delete(`/v1/grants/${grantId}`);

// Ingest data
await client.post(`/v1/data/${scope}`, data);
```

**Limitation:** `IpcClient` uses Node.js `http.request()` with `socketPath` option. Tauri's frontend (React) runs in a webview and cannot directly use Node.js APIs. This means IPC communication must go through Tauri commands (Rust backend), not the React frontend.

**Option B: Call IPC from Tauri Rust backend**

Add a Tauri command that proxies admin calls over the Unix socket:

```rust
// src-tauri/src/commands/server.rs

#[tauri::command]
async fn ipc_request(method: String, path: String, body: Option<String>) -> Result<String, String> {
    // Connect to Unix domain socket at known path
    // Send HTTP request
    // Return response body
}
```

The React frontend would then call:

```typescript
const result = await invoke("ipc_request", {
  method: "POST",
  path: "/v1/grants",
  body: JSON.stringify({ granteeAddress, scopes, expiresAt }),
});
```

**Option C: Keep HTTP for now, migrate later**

Admin routes still exist on the HTTP app during the migration period. The only behavioral change is that `POST /v1/data/:scope` on HTTP now requires local-only access (rejects tunnel traffic). DataConnect's HTTP calls to localhost still work unchanged.

**Recommended approach:** Start with Option C (keep HTTP), then migrate to Option B (Tauri IPC command) when convenient. Option A is useful for CLI tools but doesn't work in the Tauri webview context.

### What changes in `src/services/personalServer.ts`

If keeping HTTP (Option C), the only change is **removing devToken auth headers**:

Current (line 92-94):

```typescript
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (token) headers["Authorization"] = `Bearer ${token}`;
```

The devToken auth bypass is no longer needed — admin routes on HTTP during migration don't require it when called from localhost (local-only middleware only blocks tunnel traffic, not localhost).

If switching to IPC (Option B), replace all `serverFetch()` calls with `invoke('ipc_request', ...)`.

---

## 4. Centralize the Lifecycle Hook

### Current problem

`usePersonalServer.ts` is used in 5+ places:

- `src/App.tsx`
- `src/pages/home/index.tsx`
- `src/pages/runs/use-runs-page.ts`
- `src/pages/settings/use-settings-page.ts`
- `src/pages/grant/use-grant-flow.ts`

Each hook instance installs its own full set of Tauri event listeners (lines 102-162):

- `personal-server-ready`
- `personal-server-error`
- `personal-server-exited`
- `personal-server-tunnel`
- `personal-server-log`
- `personal-server-dev-token`

This means 5+ copies of each listener fire simultaneously, all updating shared module-level globals:

```typescript
// lines 14-23
let _sharedPort: number | null = null;
let _sharedStatus: "stopped" | "starting" | "running" | "error" = "stopped";
let _sharedTunnelUrl: string | null = null;
let _sharedDevToken: string | null = null;
```

### Target architecture

**Single lifecycle controller** (React context or Zustand store) that:

1. Owns the Tauri process (start/stop/restart)
2. Listens to Tauri events exactly once
3. Manages state centrally
4. Exposes read-only state + actions to components

**Implementation using Zustand (recommended — already used in project):**

```typescript
// src/store/personal-server.ts

interface PersonalServerState {
  status: "stopped" | "starting" | "running" | "error";
  port: number | null;
  tunnelUrl: string | null;
  socketPath: string | null;
  error: string | null;

  // Actions
  start: (opts: StartOptions) => Promise<void>;
  stop: () => Promise<void>;
  restart: (opts: StartOptions) => Promise<void>;
}
```

**Key changes:**

- Event listeners registered ONCE at app startup (in `App.tsx` or a provider)
- Components call `usePersonalServerStore()` for read-only state
- Only `App.tsx` calls `start()` / `stop()`
- Retry logic moves to Rust (Supervisor) or stays in the store, not in the hook

### Two-phase startup (currently lines 170-192)

Phase 1 (unauthenticated): Start server immediately on app launch

```typescript
await invoke("start_personal_server", { port: null, masterKeySignature: null });
```

Phase 2 (authenticated): Restart with wallet credentials

```typescript
await invoke("start_personal_server", {
  masterKeySignature: sig,
  ownerAddress: wallet,
});
```

This two-phase model stays the same. The difference is it's triggered from one place.

---

## 5. Use PID File for Server Discovery

### Current approach

`server.rs` tracks port from stdout JSON message:

```rust
// line 282-292
"ready" => {
    let port = msg.get("port").and_then(|p| p.as_u64()).unwrap_or(0) as u16;
    app_handle.emit("personal-server-ready", json!({ "port": port }));
}
```

### New approach

After starting the server, read the PID file at `{storageRoot}/server.json`:

```json
{
  "pid": 12345,
  "port": 8080,
  "socketPath": "/Users/user/.data-connect/personal-server/ipc.sock",
  "version": "0.1.0",
  "startedAt": "2025-02-12T10:30:00.000Z"
}
```

The PID file is written by `packages/server/src/index.ts` (lines 52-59) after both HTTP and IPC listeners are up.

**Benefits:**

- Can detect already-running server via `checkRunningServer(storageRoot)` — checks if PID is alive
- Socket path for IPC is discoverable
- Version and start time available for diagnostics

**Where to use in DataConnect:**

- `server.rs` can poll for PID file after spawning process (instead of relying solely on stdout `ready` message)
- `usePersonalServer` can read PID file to reconnect to existing server on app restart

---

## 6. Adopt Supervisor for Crash Recovery

### Current retry logic (`usePersonalServer.ts` lines 131-142)

```typescript
// On personal-server-exited event:
if (_restartCount < MAX_RESTART_ATTEMPTS) {
  _restartCount++;
  const delay = Math.pow(2, _restartCount) * 1000; // 2s, 4s, 8s
  setTimeout(() => startServer(), delay);
}
```

- Max 3 attempts
- Exponential backoff: 2s, 4s, 8s
- Lives in React hook (fragile, unmount = restart logic lost)

### New: Supervisor class (`packages/runtime/src/supervisor.ts`)

```typescript
const supervisor = new Supervisor({
  command: nodePath,
  args: [entryScript],
  spawnOptions: { env: { PORT, CONFIG_DIR, ... } },
  baseDelayMs: 1000,      // First retry after 1s
  maxDelayMs: 60000,      // Cap at 60s
  maxJitterMs: 1000,      // Random jitter 0-1s
  maxRetries: 10,         // 10 attempts before giving up
  resetAfterMs: 30000,    // Reset counter if alive > 30s
});

supervisor.on('start', (pid) => { /* emit ready event */ });
supervisor.on('exit', (code, signal) => { /* log */ });
supervisor.on('restart', (attempt, delayMs) => { /* log */ });
supervisor.on('max-retries', () => { /* give up, notify user */ });

supervisor.start();
// Later:
await supervisor.stop(); // SIGTERM, 5s timeout, then SIGKILL
```

**Where to integrate:** The Supervisor can be used either:

- **In Rust (`server.rs`):** Rust spawns Node process and handles restart logic natively
- **In the wrapper (`index.js`):** Wrapper uses Supervisor to manage the server process
- **In Tauri frontend:** Less ideal — React shouldn't own process lifecycle

**Recommended:** Use Supervisor from the wrapper if keeping a wrapper, or implement equivalent restart logic in Rust. The key is moving crash recovery out of the React hook.

---

## 7. Release Workflow Simplification

### Current release steps for personal-server (`.github/workflows/release.yml`)

1. `npm ci` in `personal-server/` (line 115-116)
2. `npm run build` — runs pkg (line 118-120)
3. Code sign the binary (line 122-127)
4. Tauri build (creates `.app`)
5. Find all `.node` files, sign each individually (line 183-188)
6. Copy `node_modules/` into `.app/Contents/Resources/personal-server/dist/` (line 202-203)
7. Re-sign entire `.app` (line 214-221)
8. Create DMG with node_modules verification (line 228-265)
9. Notarize and staple (line 268-290)
10. For Linux: extract AppImage → inject node_modules → repack (line 294-313)

### New release steps

1. Download Node.js 22 binary for target platform
2. `npm ci` in `personal-server/` (dependencies only, no build step)
3. Tauri build (bundles Node binary + personal-server folder as resources)
4. Sign `.app` once (includes Node binary)
5. Create DMG
6. Notarize and staple
7. For Linux: standard AppImage (no repack needed)

Steps 3-7 of the current workflow are eliminated entirely.

---

## 8. Environment Variables and Config

### Current env vars passed by server.rs (lines 138-156)

| Variable                    | Purpose                | Still needed?                            |
| --------------------------- | ---------------------- | ---------------------------------------- |
| `PORT`                      | HTTP listen port       | Yes                                      |
| `NODE_ENV`                  | Always `production`    | Yes                                      |
| `VANA_MASTER_KEY_SIGNATURE` | EIP-712 key derivation | Yes                                      |
| `GATEWAY_URL`               | Data gateway endpoint  | Yes                                      |
| `OWNER_ADDRESS`             | Owner wallet address   | Yes                                      |
| `CONFIG_DIR`                | Storage root path      | Yes, maps to `PERSONAL_SERVER_ROOT_PATH` |

Note: personal-server-ts `index.ts` reads `PERSONAL_SERVER_ROOT_PATH` (line 18), not `CONFIG_DIR`. The wrapper maps `CONFIG_DIR` → config loading. If eliminating the wrapper, `server.rs` should set `PERSONAL_SERVER_ROOT_PATH` instead.

### Config directory

Current default: `~/.data-connect/personal-server` (set in `server.rs` lines 153-156)

PID file will be at: `~/.data-connect/personal-server/server.json`
IPC socket will be at: `~/.data-connect/personal-server/ipc.sock` (or `/tmp/vana-ps-{hash}.sock` if path > 100 bytes on macOS)

---

## 9. Endpoint Reference (Admin App over IPC)

These are the admin routes available on the IPC socket (`packages/server/src/admin-app.ts`). No auth headers required — socket permissions enforce trust boundary.

### Data Ingest

```
POST /v1/data/:scope
Body: { ...data }
Response: 201 { scope, collectedAt, status: "stored" | "syncing" }
```

### Data Delete

```
DELETE /v1/data/:scope
Response: 204
```

### List Grants

```
GET /v1/grants
Response: 200 { grants: Grant[] }
```

### Create Grant

```
POST /v1/grants
Body: { granteeAddress: "0x...", scopes: string[], expiresAt?: number, nonce?: number }
Response: 201 { grantId: string }
Error 404: { error: { errorCode: "BUILDER_NOT_REGISTERED", ... } }
```

### Revoke Grant

```
DELETE /v1/grants/:grantId
Response: 200 { revoked: true }
```

### Access Logs

```
GET /v1/access-logs?limit=50&offset=0
Response: 200 { logs: AccessLog[], total: number }
```

### Sync Status

```
GET /v1/sync/status
Response: 200 { enabled, running, lastSync, lastProcessedTimestamp, pendingFiles, errors }
```

### Trigger Sync

```
POST /v1/sync/trigger
Response: 202 { status: "started", message: "Sync triggered" }
```

---

## 10. Readiness & Health Detection (Replaces Stdout Protocol)

The wrapper's stdout JSON-line protocol is eliminated. DataConnect uses file-based and HTTP-based detection instead.

### Readiness detection

After spawning the Node process, `server.rs` polls for the PID file:

**PID file location:** `{storageRoot}/server.json` (written by `packages/server/src/index.ts` lines 52-59)

```json
{
  "pid": 12345,
  "port": 8080,
  "socketPath": "/Users/user/.data-connect/personal-server/ipc.sock",
  "version": "0.1.0",
  "startedAt": "2026-02-12T10:30:00.000Z"
}
```

Poll strategy: check file existence every 250ms, timeout after 30s. File appears only after both HTTP and IPC listeners are ready.

### Health and tunnel URL

**`GET /status`** (on HTTP, no auth):

```json
{ "status": "running", "owner": "0x...", "port": 8080 }
```

**`GET /health`** (on HTTP, no auth): Returns full server info including tunnel URL, identity, and connected services.

### Error detection

- **Process exit:** `server.rs` already handles `child.wait()` and emits `personal-server-exited` event
- **Startup failure:** PID file never appears within timeout → emit `personal-server-error`
- **Logs:** pino writes to stdout (captured by `server.rs` as raw text) and to `{storageRoot}/daemon.log`

---

## Implementation Order

**No changes to personal-server-ts are required.** All work is in DataConnect.

### Phase A: Eliminate pkg + wrapper + stdout protocol (do together)

| #   | Change                                            | Files to modify/delete                                                                                                                                                                                                           |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Delete wrapper + pkg pipeline                     | `personal-server/index.js` (delete), `personal-server/index.cjs` (delete), `personal-server/scripts/build.js` (delete), `scripts/ensure-personal-server.js` (delete), `personal-server/package.json` (simplify to thin dep spec) |
| A2  | Ship Node.js binary, run PS entry point directly  | `src-tauri/tauri.conf.json`, `src-tauri/src/commands/server.rs`, `scripts/build-prod.js`                                                                                                                                         |
| A3  | Replace stdout JSON parsing with PID file polling | `src-tauri/src/commands/server.rs` — delete stdout reader thread, add PID file poll                                                                                                                                              |
| A4  | Simplify release workflow                         | `.github/workflows/release.yml` — delete pkg build, .node signing, node_modules injection, AppImage repack; add Node.js binary download                                                                                          |

### Phase B: Auth + lifecycle cleanup (independent items, can parallel with A)

| #   | Change                                       | Files                                                                                                                                                                  |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Remove devToken auth from admin calls        | `src/services/personalServer.ts` — remove `Authorization: Bearer` headers                                                                                              |
| B2  | Centralize lifecycle hook into Zustand store | `src/hooks/usePersonalServer.ts` → `src/store/personal-server.ts`, update `App.tsx`, `home/index.tsx`, `use-runs-page.ts`, `use-settings-page.ts`, `use-grant-flow.ts` |

### Phase C: IPC migration (sequential, after Phase A)

| #   | Change                      | Files                                                                                                                           |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Add IPC proxy Tauri command | `src-tauri/src/commands/server.rs` — new `ipc_request` command using UDS                                                        |
| C2  | Switch service calls to IPC | `src/services/personalServer.ts`, `src/services/personalServerIngest.ts` — replace `serverFetch()` with `invoke('ipc_request')` |

### Phase D: Process management (independent, after Phase A)

| #   | Change                              | Files                                                                                         |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| D1  | Adopt Supervisor for crash recovery | `src-tauri/src/commands/server.rs` — implement restart logic in Rust, remove React hook retry |

**Dependencies:**

- Phase A has no prerequisites — personal-server-ts changes are already landed
- Phase B is independent and can be done in parallel with Phase A
- Phase C requires Phase A (PID file provides socket path for IPC)
- Phase D requires Phase A (Node.js binary spawning must work first)
- C1 must complete before C2
