# Desktop App (dataConnect) — Connect Flow Changes

---

## 1. Overview

This document specifies how dataConnect wires into the Data Portability Protocol to let builders request access to a user's data. It replaces the current placeholder APIs and mock signatures with real integrations to the Session Relay, Personal Server grant endpoint, and Gateway builder registry.

### What's changing

| Area            | Current                           | New                                                                        |
| --------------- | --------------------------------- | -------------------------------------------------------------------------- |
| Deep link       | URL query params                  | `vana://connect?sessionId={id}&secret={secret}` via Tauri deep-link plugin |
| Session relay   | Old `/sessions/*` endpoints       | `/v1/session/claim`, `/v1/session/{id}/approve`, `/v1/session/{id}/deny`   |
| Grant signing   | Mock EIP-712 in dataConnect       | Personal Server `POST /v1/grants` — server signs and submits to Gateway    |
| Builder info    | Hardcoded registry (one demo app) | Gateway `GET /v1/builders/{address}` + manifest fetch                      |
| Connected apps  | No `grantId` stored               | Gateway is source of truth; fetch via Personal Server `GET /v1/grants`     |
| Auth flow order | Consent before sign-in            | **Sign-in before consent** (server needs wallet to sign grants)            |

### Corrected screen order

```
Screen 1: "Connect your ChatGPT"     ← deep link landing, session claim
Screen 2: "Sign in" (Vana Passport)   ← wallet + master key → server can sign
Screen 3: "Allow access" (consent)     ← grant creation + session approve
Screen 4: "Connected" (success)        ← confirmation
```

The critical ordering fix: **sign-in must happen before consent** because the Personal Server needs `VANA_MASTER_KEY_SIGNATURE` (derived from the owner wallet) to create grants. No wallet → no server signer → grant creation fails.

---

## 2. End-to-End Sequence Diagram

Five actors: Builder App, Session Relay, dataConnect, Personal Server, Gateway.

```
Builder App           Session Relay          dataConnect           Personal Server       Gateway
    │                      │                      │                      │                  │
    │  POST /v1/session/init                      │                      │                  │
    ├─────────────────────►│                      │                      │                  │
    │◄─ sessionId, deepLink┤                      │                      │                  │
    │                      │                      │                      │                  │
    │  (user clicks link)  │                      │                      │                  │
    │  vana://connect?sessionId=..&secret=..      │                      │                  │
    ├────────────────────────────────────────────►│                      │                  │
    │                      │                      │                      │                  │
    │                      │   POST /v1/session/claim                    │                  │
    │                      │◄─────────────────────┤                      │                  │
    │                      ├─ granteeAddr,scopes─►│                      │                  │
    │                      │                      │                      │                  │
    │                      │                      │   GET /v1/builders/{addr}               │
    │                      │                      ├────────────────────────────────────────►│
    │                      │                      │◄── appUrl, publicKey ───────────────────┤
    │                      │                      │                      │                  │
    │                      │                      │  GET {appUrl}/.well-known/vana-manifest.json
    │                      │                      ├──►(builder's server) │                  │
    │                      │                      │◄── name, icon, desc  │                  │
    │                      │                      │                      │                  │
    │                      │                      │  [SIGN-IN via Privy] │                  │
    │                      │                      │  wallet + masterKey  │                  │
    │                      │                      ├─ start server ──────►│                  │
    │                      │                      │                      │                  │
    │                      │                      │  [USER CONSENTS]     │                  │
    │                      │                      │                      │                  │
    │                      │                      │  POST /v1/grants     │                  │
    │                      │                      ├─────────────────────►│  POST /v1/grants │
    │                      │                      │                      ├─────────────────►│
    │                      │                      │                      │◄── grantId ──────┤
    │                      │◄─────────────────────┤◄── grantId ──────────┤                  │
    │                      │  POST /v1/session/{id}/approve              │                  │
    │                      │  (grantId, userAddr, scopes)                │                  │
    │                      │                      │                      │                  │
    │  GET /v1/session/{id}/poll                  │                      │                  │
    ├─────────────────────►│                      │                      │                  │
    │◄─ approved, grantId ─┤                      │                      │                  │
```

---

## 3. Screen-by-Screen Walkthrough

### Screen 1: "Connect your ChatGPT"

This is the **existing data export page**. It doubles as the deep link landing where session claim happens in the background.

```
┌──────────────────────────────────────────┐
│  dataConnect                             │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │   Connect your ChatGPT             │  │
│  │                                    │  │
│  │  This saves your ChatGPT data      │  │
│  │  to your computer so you own it.   │  │
│  │                                    │  │
│  │  [Start Export]                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  (background: claiming session,          │
│   verifying builder...)                  │
└──────────────────────────────────────────┘
```

**Trigger**: `vana://connect?sessionId={id}&secret={secret}` opens dataConnect to this page.

**What happens behind the scenes**:

1. **Claim session** — `POST /v1/session/claim` with `{ sessionId, secret }`. Receives `granteeAddress`, `scopes`, `expiresAt`.
2. **Verify builder** — `GET /v1/builders/{granteeAddress}` on Gateway to get `appUrl` and `publicKey`. Then fetch `{appUrl}/.well-known/vana-manifest.json` for display name, icon, and description.
3. dataConnect now knows who the builder is and what scopes they want. It shows the data connector context (e.g., "This saves your ChatGPT data to your computer").

**Data received**:

- `granteeAddress` — builder's wallet address
- `scopes` — e.g., `["chatgpt.conversations"]`
- Builder manifest — name, icon, description, privacy/terms URLs

---

### Screen 2: "Sign in" (Vana Passport)

Shown if the user is not already authenticated. This must happen **before** consent because the Personal Server needs the wallet to sign grants.

```
┌──────────────────────────────────────────┐
│  dataConnect                             │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Sign in with Vana                 │  │
│  │                                    │  │
│  │  Sign in to allow apps to access   │  │
│  │  your data.                        │  │
│  │                                    │  │
│  │  [Sign in with Google]             │  │
│  │  [Sign in with Email]              │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

**Trigger**: User not authenticated (no wallet address available).

**What happens behind the scenes**:

1. **Privy auth** — User signs in via Privy (Google, email, etc.). dataConnect receives wallet address + master key signature.
2. **Personal Server starts** — dataConnect launches the bundled Personal Server with `VANA_MASTER_KEY_SIGNATURE`. The server derives its signing keypair from this.
3. **Server registers with Gateway** — The Personal Server registers itself so it can sign grants and receive data requests.

**Key dependency**: The Personal Server cannot create grants until this step completes. The server's derived keypair (from `VANA_MASTER_KEY_SIGNATURE`) is what signs the EIP-712 `GrantRegistration` submitted to Gateway.

**If already signed in**: This screen is skipped entirely.

---

### Screen 3: "Allow access to your ChatGPT data" (consent)

The user decides whether to grant the builder access.

```
┌──────────────────────────────────────────┐
│  dataConnect                             │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  RickRoll Facts                    │  │
│  │  wants access to your data         │  │
│  │                                    │  │
│  │  Permissions requested:            │  │
│  │  ☑ ChatGPT conversations           │  │
│  │                                    │  │
│  │  Privacy Policy · Terms            │  │
│  │                                    │  │
│  │  [Cancel]            [Allow]       │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

**Trigger**: User is authenticated, builder is verified, Personal Server is running.

**What happens when the user clicks Allow**:

1. **Create grant** — dataConnect calls Personal Server `POST /v1/grants` with `{ granteeAddress, scopes }`. The server signs an EIP-712 `GrantRegistration`, submits it to Gateway, and returns `{ grantId }`.
2. **Approve session** — dataConnect calls Session Relay `POST /v1/session/{id}/approve` with `{ secret, grantId, userAddress, scopes }`. This tells the builder's polling loop that the grant is ready.

**What happens when the user clicks Cancel**:

1. **Deny session** — dataConnect calls Session Relay `POST /v1/session/{id}/deny` with `{ secret, reason: "User declined" }`.
2. Navigate home. No grant is created.

**Display metadata** (from builder manifest):

- Builder name and icon
- Description of what the builder does
- Requested scopes (human-readable labels)
- Links to privacy policy, terms of service, support

---

### Screen 4: "RickRoll has your ChatGPT data" (success)

Confirmation that the grant was created and the builder was notified.

```
┌──────────────────────────────────────────┐
│  dataConnect                             │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  RickRoll Facts now has            │  │
│  │      access to your ChatGPT data   │  │
│  │                                    │  │
│  │  You can manage or revoke access   │  │
│  │  in Settings > Connected Apps.     │  │
│  │                                    │  │
│  │  [Done]                            │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

**Trigger**: Grant created + session approved.

**No local `grantId` storage needed**: Gateway is the source of truth. The Connected Apps page can fetch grants from Gateway via Personal Server `GET /v1/grants` (returns grantId, grantee, scopes, revocation status).

**On the builder side**: The builder's app polls Session Relay `GET /v1/session/{id}/poll`, receives `{ status: "approved", grant: { grantId, userAddress, scopes } }`, and can now use the grantId to fetch data from the user's Personal Server.

---

## 4. Key Architectural Change: Sign-in Before Consent

### Why the order changed

The previous flow (and current dataConnect code) shows consent/grant creation **before** sign-in. This cannot work with real protocol integrations because:

1. **Grant creation requires a server signer** — `POST /v1/grants` on the Personal Server signs an EIP-712 `GrantRegistration` with a derived keypair.
2. **The derived keypair comes from `VANA_MASTER_KEY_SIGNATURE`** — which is produced during Privy auth when the user's wallet signs a deterministic message.
3. **No wallet → no master key signature → no server signer → `POST /v1/grants` returns 500** (`SERVER_SIGNER_NOT_CONFIGURED`).

### Dependency chain

```
Privy auth
  └─► wallet address + master key signature
        └─► Personal Server starts with VANA_MASTER_KEY_SIGNATURE
              └─► server derives signing keypair
                    └─► POST /v1/grants can sign GrantRegistration
                          └─► Gateway records grant, returns grantId
                                └─► POST /v1/session/{id}/approve with grantId
```

Every step depends on the one above it. Sign-in is the root dependency.

### What this means for the state machine

```
loading → claiming → verifying-builder → auth-required → consent → creating-grant → approving → success
                                              │
                                         (skipped if
                                          already
                                          signed in)
```

If the user is already authenticated, the flow jumps from `verifying-builder` straight to `consent`.

---

## 5. Builder App Registration (Separate Flow)

This is **not** part of the connect flow. It's a new settings/admin page where builders register their app with the protocol (tracked as BUI-108).

```
┌──────────────────────────────────────────┐
│  Settings > Builder Apps                 │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Register a new app                │  │
│  │                                    │  │
│  │  App URL: [https://example.com]    │  │
│  │                                    │  │
│  │  [Register]                        │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Registered Apps                         │
│  ┌────────────────────────────────────┐  │
│  │  App ID     Private Key   App URL  │  │
│  │  0x1a2b..   ••••••••••   ex.com    │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

**Protocol step**: Gateway `POST /v1/builders` to register the app on-chain. This creates the builder record that the connect flow later looks up during builder verification (Screen 1, step 2).

---

## 6. Open Questions

1. **Scope subset selection** — Should users be able to deselect individual scopes on the consent screen? The Session Relay supports it (approved scopes must be a subset of requested). For v1, approving all-or-nothing is simpler.

2. **Error recovery for split failure** — If `POST /v1/grants` succeeds but `POST /v1/session/{id}/approve` fails (e.g., session expired), the grant exists on Gateway but the builder never learns about it. Should dataConnect retry the approve call? Store the pending grantId locally and retry on next app open?

3. **Offline builder manifest** — If the builder's `appUrl` is unreachable, should dataConnect fall back to Gateway-only metadata (address + public key) and show an "unverified app" warning?

4. **Demo mode** — Current flow supports `sessionId.startsWith("grant-session-")` for demo apps. Keep this for development/testing but gate it behind a dev flag.

---

## 7. Implementation Order

Suggested PR sequence — each change is small and independently testable.

### PR 1: Deep Link Registration

- Add Tauri deep-link plugin (`Cargo.toml`, `tauri.conf.json`, Rust init)
- Parse `secret` from deep link URL
- Listen for `onOpenUrl` events in dataConnect
- **Test**: Build app, open `vana://connect?sessionId=test&secret=abc`, verify params reach grant page

### PR 2: Session Relay Client

- Rewrite `sessionRelay.ts` with new endpoints (`claim`, `approve`, `deny`)
- Add error types matching session-relay error format
- **Test**: Unit tests mocking fetch, verify request/response shapes

### PR 3: Personal Server Grant Client + Auth

- New `personalServer.ts` service client
- Dev token generation in Tauri backend for localhost auth
- **Test**: Integration test against running Personal Server

### PR 4: Builder Manifest Discovery

- New `builder.ts` service for Gateway lookup + manifest fetch
- Manifest signature verification
- **Test**: Unit tests with mock manifest responses

### PR 5: Grant Flow State Machine Rewrite

- New state machine: `loading → claiming → verifying-builder → auth-required → consent → creating-grant → approving → success`
- Wire up all services (relay → builder → auth → personal server → relay)
- **Test**: Component tests for each state transition

### PR 6: Consent UI + Connected Apps

- Update consent screen with builder manifest metadata
- Connected Apps page fetches grants from Gateway via Personal Server
- **Test**: Visual review, verify grant list renders correctly

### PR 7: Deny Flow + Error Handling

- Deny button → relay deny call → navigate home
- Error recovery for split failures (grant created but approve failed)
- **Test**: E2E deny flow, error state transitions

---

## Appendix: API Reference

### Session Relay

**Base URL**: `https://session-relay.vana.org`

| Method | Path                       | Auth                  | Purpose                      |
| ------ | -------------------------- | --------------------- | ---------------------------- |
| `POST` | `/v1/session/init`         | Web3Signed (builder)  | Create a new session         |
| `POST` | `/v1/session/claim`        | None (secret in body) | Desktop App claims a session |
| `POST` | `/v1/session/{id}/approve` | None (secret in body) | Approve with grantId         |
| `POST` | `/v1/session/{id}/deny`    | None (secret in body) | Deny session                 |
| `GET`  | `/v1/session/{id}/poll`    | None                  | Builder polls for result     |

**Session states**: `pending` → `claimed` (via claim) → `approved` (via approve) or `denied` (via deny). Sessions expire after TTL.

**Claim request body**: `{ sessionId, secret }`
**Claim response**: `{ sessionId, granteeAddress, scopes, expiresAt, webhookUrl?, appUserId? }`

**Approve request body**: `{ secret, grantId, userAddress, scopes }`
**Deny request body**: `{ secret, reason? }`

**Poll response (approved)**: `{ status: "approved", grant: { grantId, userAddress, scopes } }`

**Error shape**: `{ error: { code, errorCode, message, details? } }`
**Error codes**: `SESSION_NOT_FOUND`, `SESSION_EXPIRED`, `INVALID_SESSION_STATE`, `INVALID_CLAIM_SECRET`, `VALIDATION_ERROR`

### Personal Server

**Base URL**: `http://localhost:{port}`

| Method | Path                | Auth                               | Purpose                                     |
| ------ | ------------------- | ---------------------------------- | ------------------------------------------- |
| `POST` | `/v1/grants`        | Owner (Web3Signed or Bearer token) | Create grant → sign → submit to Gateway     |
| `GET`  | `/v1/grants`        | Owner                              | List all grants for this user               |
| `POST` | `/v1/grants/verify` | None                               | Verify a grant signature (used by builders) |

**Create grant request body**: `{ granteeAddress, scopes, expiresAt?, nonce? }`
**Create grant response (201)**: `{ grantId }`

**Internal flow for `POST /v1/grants`**:

1. Validate request body
2. Look up builder via Gateway (`GET /v1/builders/{granteeAddress}`)
3. Build grant payload (user, builder, scopes, expiresAt, nonce)
4. Sign EIP-712 `GrantRegistration` with server's derived keypair
5. Submit to Gateway
6. Return `{ grantId }`

**Auth for bundled server**: dataConnect generates a random dev token at startup, passes it as `VANA_DEV_TOKEN` env var to the Personal Server process, and uses `Authorization: Bearer {devToken}` for all local requests.

### Gateway

| Method | Path                     | Auth                 | Purpose                      |
| ------ | ------------------------ | -------------------- | ---------------------------- |
| `GET`  | `/v1/builders/{address}` | None                 | Look up builder registration |
| `POST` | `/v1/builders`           | Web3Signed (builder) | Register a builder app       |
| `POST` | `/v1/grants`             | Web3Signed (server)  | Record a signed grant        |
| `GET`  | `/v1/grants`             | Web3Signed (owner)   | List grants for an owner     |

**Builder lookup response**: `{ id, appUrl, publicKey, ... }`

**Manifest URL**: `{appUrl}/.well-known/vana-manifest.json`
**Manifest fields**: `name`, `icon`, `description`, `scopes`, `privacyUrl`, `termsUrl`, `supportUrl`
