# Desktop App (dataConnect) — Connect Flow Changes

---

## 1. Overview

This document specifies how dataConnect wires into the Data Portability Protocol to let builders request access to a user's data. It replaces the current placeholder APIs and mock signatures with real integrations to the Session Relay, Personal Server grant endpoint, and Gateway builder registry.

### What's changing

| Area            | Current                           | New                                                                                         |
| --------------- | --------------------------------- | ------------------------------------------------------------------------------------------- |
| Deep link       | URL query params                  | `vana://connect?sessionId={id}&secret={secret}` via Tauri deep-link plugin                  |
| Session relay   | Old `/sessions/*` endpoints       | `/v1/session/claim`, `/v1/session/{id}/approve`, `/v1/session/{id}/deny`                    |
| Grant signing   | Mock EIP-712 in dataConnect       | Personal Server `POST /v1/grants` — server signs and submits to Gateway                     |
| Builder info    | Hardcoded registry (one demo app) | Gateway `GET /v1/builders/{address}` + manifest fetch                                       |
| Connected apps  | No `grantId` stored               | Gateway is source of truth; fetch via Personal Server `GET /v1/grants`                      |
| Auth flow order | Consent before sign-in (mock)     | **Consent before sign-in** — session data held in state; sign-in deferred to grant creation |

### Screen order

```
Screen 1: "Connect your ChatGPT"     ← deep link landing, session claim
Screen 2: Browser scraping            ← user exports their data
Screen 3: "Allow access" (consent)    ← user approves scopes (session data held in state)
Screen 4: "Sign in" (Vana Passport)   ← wallet + master key → server can sign
Screen 5: "Connected" (success)       ← grant creation + session approve + confirmation
```

Session claim data (`granteeAddress`, `scopes`, builder manifest) is held in app state throughout the flow. The user sees what data will be shared and consents **before** being asked to sign in. Sign-in is deferred until grant creation time — the only step that actually requires a wallet and the Personal Server's derived keypair. If the user is already signed in, Screen 4 is skipped automatically.

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
    │                      │                      │  GET {appUrl}        │                  │
    │                      │                      ├──►(builder's server) │                  │
    │                      │                      │◄── HTML with <link rel="manifest">      │
    │                      │                      │                      │                  │
    │                      │                      │  GET {manifestUrl}   │                  │
    │                      │                      ├──►(builder's server) │                  │
    │                      │                      │◄── W3C manifest with vana block         │
    │                      │                      │                      │                  │
    │                      │                      │  [DATA EXPORT]       │                  │
    │                      │                      │  browser scraping    │                  │
    │                      │                      │                      │                  │
    │                      │                      │  [USER CONSENTS]     │                  │
    │                      │                      │  (held in app state) │                  │
    │                      │                      │                      │                  │
    │                      │                      │  [SIGN-IN via Privy] │                  │
    │                      │                      │  wallet + masterKey  │                  │
    │                      │                      ├─ start server ──────►│                  │
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

This is the **deep link landing page**. Session claim and builder verification happen in the background while the user sees the data export prompt.

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
2. **Verify builder** — `GET /v1/builders/{granteeAddress}` on Gateway to get `appUrl` and `publicKey`. Then fetch `{appUrl}` HTML, resolve the `<link rel="manifest">` tag, fetch the linked W3C Web App Manifest, and read the `vana` block for display name, icon, privacy/terms URLs, and signature. Verify the `vana.signature` recovers the builder address.
3. dataConnect now knows who the builder is and what scopes they want. Session data (`granteeAddress`, `scopes`, builder manifest) is stored in app state for later use.

**Data held in state**:

- `granteeAddress` — builder's wallet address
- `scopes` — e.g., `["chatgpt.conversations"]`
- Builder manifest — name, icon, description, privacy/terms URLs

---

### Screen 2: Browser Scraping (data export)

The user exports their data via an embedded browser. This happens before consent so the user understands what data they're sharing.

```
┌──────────────────────────────────────────┐
│  dataConnect                             │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │   Exporting your ChatGPT data...   │  │
│  │                                    │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │  (embedded browser)          │  │  │
│  │  │  chatgpt.com/...             │  │  │
│  │  │                              │  │  │
│  │  └──────────────────────────────┘  │  │
│  │                                    │  │
│  │  Progress: ████████░░ 80%          │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

**Trigger**: User clicks "Start Export" on Screen 1.

**What happens**:

1. dataConnect opens an embedded browser (webview) pointed at the data source (e.g., ChatGPT).
2. The user's data is scraped and saved locally to their machine.
3. Once export completes, the flow advances to the consent screen.

**Why before consent**: The user gets to see their data being exported before deciding whether to share it with the builder. This builds trust — they know exactly what data is at stake.

---

### Screen 3: "Allow access to your ChatGPT data" (consent)

The user decides whether to grant the builder access. No authentication is required at this step — the user's decision is recorded in app state.

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

**Trigger**: Builder verified + session claimed + data export complete.

**What happens when the user clicks Allow**:

1. The user's consent decision is recorded in app state (no protocol calls yet).
2. If the user is **not authenticated**, the flow advances to Screen 4 (sign-in).
3. If the user is **already authenticated**, Screen 4 is skipped and the flow advances directly to Screen 5 (grant creation + confirmation).

**What happens when the user clicks Cancel**:

1. **Deny session** — dataConnect calls Session Relay `POST /v1/session/{id}/deny` with `{ secret, reason: "User declined" }`.
2. Navigate home. No grant is created.

**Display metadata** (from builder manifest):

- Builder name and icon
- Description of what the builder does
- Requested scopes (human-readable labels)
- Links to privacy policy, terms of service, support

---

### Screen 4: "Sign in" (Vana Passport)

Shown only if the user is not already authenticated. Sign-in is deferred to this point — after the user has already seen their data and consented to sharing it.

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

**Trigger**: User clicked Allow on Screen 3 but is not authenticated (no wallet address available).

**What happens behind the scenes**:

1. **Privy auth** — User signs in via Privy (Google, email, etc.). dataConnect receives wallet address + master key signature.
2. **Personal Server starts** — dataConnect launches the bundled Personal Server with `VANA_MASTER_KEY_SIGNATURE`. The server derives its signing keypair from this.
3. **Server registers with Gateway** — The Personal Server registers itself so it can sign grants and receive data requests.
4. Once sign-in completes, the flow automatically advances to Screen 5.

**If already signed in**: This screen is skipped entirely. The flow goes directly from consent (Screen 3) to confirmation (Screen 5).

---

### Screen 5: "Connected" (success)

Grant creation, session approval, and confirmation all happen on this screen. This is where the actual protocol work occurs — now that the user has consented and is authenticated.

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

**Trigger**: User consented (Screen 3) + user authenticated (Screen 4, or already signed in).

**What happens behind the scenes**:

1. **Create grant** — dataConnect calls Personal Server `POST /v1/grants` with `{ granteeAddress, scopes }` (from app state). The server signs an EIP-712 `GrantRegistration`, submits it to Gateway, and returns `{ grantId }`.
2. **Approve session** — dataConnect calls Session Relay `POST /v1/session/{id}/approve` with `{ secret, grantId, userAddress, scopes }`. This tells the builder's polling loop that the grant is ready.
3. **Show confirmation** — The success screen is displayed.

**No local `grantId` storage needed**: Gateway is the source of truth. The Connected Apps page can fetch grants from Gateway via Personal Server `GET /v1/grants` (returns grantId, grantee, scopes, revocation status).

**On the builder side**: The builder's app polls Session Relay `GET /v1/session/{id}/poll`, receives `{ status: "approved", grant: { grantId, userAddress, scopes } }`, and can now use the grantId to fetch data from the user's Personal Server.

---

## 4. Key Architectural Change: Deferred Sign-in

### Why sign-in is deferred

The dependency chain for grant creation is unchanged — sign-in is still required before the Personal Server can create grants. What changed is **when** sign-in happens in the UX flow.

The key insight: session claim data (`granteeAddress`, `scopes`, builder manifest) can be held in app state. Sign-in is only needed at grant creation time, not at consent time. This means we can collect consent **before** asking the user to sign in.

### UX flow vs. dependency chain

The UX flow is: **claim → export → consent → sign-in → grant creation**

But the technical dependency chain remains:

```
Privy auth
  └─► wallet address + master key signature
        └─► Personal Server starts with VANA_MASTER_KEY_SIGNATURE
              └─► server derives signing keypair
                    └─► POST /v1/grants can sign GrantRegistration
                          └─► Gateway records grant, returns grantId
                                └─► POST /v1/session/{id}/approve with grantId
```

Sign-in is still the root dependency for grant creation. The difference is that sign-in only fires **after** the user has already seen their data, understood the request, and committed to allowing access. Session data and the consent decision are held in app state until sign-in completes and grant creation can proceed.

### Benefit

Better UX — the user sees what they're consenting to before being asked to sign in. Users who would decline can do so without ever needing to authenticate.

### What this means for the state machine

```
loading → claiming → verifying-builder → exporting → consent → auth-required → creating-grant → approving → success
                                                                     │
                                                                (skipped if
                                                                 already
                                                                 signed in)
```

If the user is already authenticated, the flow jumps from `consent` straight to `creating-grant`.

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
- Web3Signed client auth using the owner wallet (from Privy) for owner-only endpoints
- **Test**: Integration test against running Personal Server

### PR 4: Builder Manifest Discovery

- New `builder.ts` service for Gateway lookup + manifest fetch
- Manifest signature verification
- **Test**: Unit tests with mock manifest responses

### PR 5: Grant Flow State Machine Rewrite

- New state machine: `loading → claiming → verifying-builder → exporting → consent → auth-required → creating-grant → approving → success`
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

| Method | Path                | Auth               | Purpose                                     |
| ------ | ------------------- | ------------------ | ------------------------------------------- |
| `POST` | `/v1/grants`        | Owner (Web3Signed) | Create grant → sign → submit to Gateway     |
| `GET`  | `/v1/grants`        | Owner (Web3Signed) | List all grants for this user               |
| `POST` | `/v1/grants/verify` | None               | Verify a grant signature (used by builders) |

**Create grant request body**: `{ granteeAddress, scopes, expiresAt?, nonce? }`
**Create grant response (201)**: `{ grantId }`

**Internal flow for `POST /v1/grants`**:

1. Validate request body
2. Look up builder via Gateway (`GET /v1/builders/{granteeAddress}`)
3. Build grant payload (user, builder, scopes, expiresAt, nonce)
4. Sign EIP-712 `GrantRegistration` with server's derived keypair
5. Submit to Gateway
6. Return `{ grantId }`

**Auth for bundled server**: dataConnect authenticates to the Personal Server using `Web3Signed` headers signed by the owner wallet (obtained from Privy auth). Each owner-only endpoint (`POST /v1/grants`, `GET /v1/grants`) requires an `Authorization: Web3Signed <base64url(json)>.<signature>` header where the signature is produced by the owner's wallet key.

### Gateway

| Method | Path                     | Auth                 | Purpose                      |
| ------ | ------------------------ | -------------------- | ---------------------------- |
| `GET`  | `/v1/builders/{address}` | None                 | Look up builder registration |
| `POST` | `/v1/builders`           | Web3Signed (builder) | Register a builder app       |
| `POST` | `/v1/grants`             | Web3Signed (server)  | Record a signed grant        |
| `GET`  | `/v1/grants`             | Web3Signed (owner)   | List grants for an owner     |

**Builder lookup response**: `{ id, appUrl, publicKey, ... }`

**Manifest Discovery**: Fetch `{appUrl}` HTML → resolve `<link rel="manifest" href="...">` (must be same-origin) → fetch the linked manifest.

**Manifest Format**: Standard W3C Web App Manifest with a `vana` block for protocol-specific metadata.

**`vana` block fields**: `appUrl`, `privacyPolicyUrl`, `termsUrl`, `supportUrl`, `webhookUrl`, `signature`

**Signature**: EIP-191 by builder address over canonical JSON of the `vana` block (sorted keys alphabetically, excluding `signature`).

**Standard manifest fields used**: `name`, `icons` (used for consent UI display).
