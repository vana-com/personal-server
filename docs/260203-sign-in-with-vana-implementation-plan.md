# Sign in with Vana - Implementation Plan

**Date:** 2026-02-03
**Status:** Draft
**Related Spec:** `docs/260121-data-portability-protocol-spec.md` (sections 4.5, 6.3, 6.6, Appendix B.2)

---

## Overview

This document outlines the implementation plan for enabling external builders to integrate with Vana's data portability protocol via a "Sign in with Vana" / "Connect Data" flow.

The flow allows users to:

1. Click "Connect Data" on a builder's web app
2. Approve data access in the Vana Desktop App
3. Grant the builder access to specific data scopes

---

## Architecture

```
Builder App                Session Relay              Desktop App           Personal Server
    |                          |                          |                      |
    |-- 1. POST /session/init -->                         |                      |
    |<-- sessionId, deepLink --|                          |                      |
    |                          |                          |                      |
    |---- 2. User clicks deep link (vana://connect) ---->|                      |
    |                          |                          |                      |
    |                          |<-- 3. POST /claim -------|                      |
    |                          |-- session details ------>|                      |
    |                          |                          |                      |
    |                          |                          |-- 4. Show consent UI |
    |                          |                          |                      |
    |                          |<-- 5. POST /approve -----|                      |
    |                          |   (signed grant)         |                      |
    |                          |                          |                      |
    |<-- 6. poll returns grant |                          |                      |
    |                          |                          |                      |
    |----------------------- 7. GET /v1/data/{scope} ------------------->|
    |                     (Authorization: Web3Signed, grantId)           |
    |<----------------------- data response -----------------------------|
```

---

## Components Required

### 1. Session Relay Service

**Purpose:** OAuth-like coordination between builder web popup and Desktop App

**Repository:** `vana-com/session-relay` (new)
**Deployment:** `session.vana.org`

#### API Endpoints

| Endpoint                        | Auth                 | Purpose                                |
| ------------------------------- | -------------------- | -------------------------------------- |
| `POST /v1/session/init`         | Web3Signed (builder) | Create session, return deepLinkUrl     |
| `GET /v1/session/{id}/poll`     | None                 | Poll for grant completion              |
| `POST /v1/session/claim`        | None (Desktop App)   | Claim session, get builder/scopes info |
| `POST /v1/session/{id}/approve` | None (Desktop App)   | Submit signed grant                    |

#### Session State Machine

```
pending → claimed → approved → completed
                              ↓
                           expired (15 min TTL)
```

#### Technical Details

**Input for `POST /v1/session/init`:**

```json
{
  "granteeAddress": "0x...",
  "scopes": ["instagram.profile", "instagram.likes"],
  "webhookUrl": "https://myapp.com/webhook", // optional
  "app_user_id": "user123" // optional
}
```

**Output:**

```json
{
  "sessionId": "uuid",
  "deepLinkUrl": "vana://connect?sessionId=uuid",
  "expiresAt": "2026-02-03T12:15:00Z"
}
```

**Grant Payload (returned via poll/webhook):**

```json
{
  "grantId": "0x...", // on-chain permissionId
  "userAddress": "0x...",
  "builderAddress": "0x...",
  "scopes": ["instagram.profile", "instagram.likes"],
  "expiresAt": 0,
  "app_user_id": "optional"
}
```

#### Tech Stack

- **Framework:** Hono (consistency with personal-server-ts)
- **Database:** Neon PostgreSQL (serverless)
- **Deployment:** Vercel

#### Database Schema

```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grantee_address TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  webhook_url TEXT,
  app_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  grant_id TEXT,
  user_address TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  claimed_at TIMESTAMP,
  approved_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```

#### Reusable Code from personal-server-ts

| Source                                  | Purpose                                                |
| --------------------------------------- | ------------------------------------------------------ |
| `packages/core/src/auth/web3-signed.ts` | `verifyWeb3Signed()` for builder authentication        |
| `packages/core/src/gateway/client.ts`   | Gateway client pattern for builder registration checks |

---

### 2. @vana/connect React Package

**Purpose:** Builder-facing SDK for "Connect Data" UI

**Repository:** `vana-com/vana-connect` (new)
**NPM Package:** `@vana/connect`

#### Package Structure

```
@vana/connect/
├── src/
│   ├── server/
│   │   ├── session-relay.ts    # Server-side session creation
│   │   ├── signing.ts          # Web3Signed header generation
│   │   └── index.ts
│   ├── react/
│   │   ├── VanaConnectProvider.tsx
│   │   ├── useVanaConnect.ts
│   │   ├── VanaConnectButton.tsx
│   │   ├── VanaConnectModal.tsx
│   │   └── index.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

#### Server-Side API (Builder Backend)

```typescript
import { createSessionRelay } from "@vana/connect/server";

const relay = createSessionRelay({
  privateKey: process.env.VANA_APP_PRIVATE_KEY,
  sessionRelayUrl: "https://session.vana.org",
});

// Create session
const { sessionId, deepLinkUrl, expiresAt } = await relay.initSession({
  granteeAddress: "0x...",
  scopes: ["instagram.profile", "instagram.likes"],
  webhookUrl: "https://myapp.com/webhook",
  app_user_id: "user123",
});
```

#### React Client API

```typescript
import { useVanaConnect, VanaConnectButton } from "@vana/connect/react";

// Hook-based usage
function MyComponent() {
  const { connect, status, grant, error } = useVanaConnect({
    sessionRelayUrl: "https://session.vana.org",
  });

  const handleConnect = async () => {
    const { sessionId } = await fetchSessionFromBackend(); // Your API call
    await connect({ sessionId });
  };

  return (
    <button onClick={handleConnect} disabled={status === "connecting"}>
      {status === "connecting" ? "Connecting..." : "Connect data"}
    </button>
  );
}

// Pre-built component
function MyApp() {
  return (
    <VanaConnectButton
      sessionId={sessionId}
      onComplete={(grant) => console.log("Got grant:", grant)}
      onError={(error) => console.error(error)}
    />
  );
}
```

#### Connection Status

```typescript
type ConnectionStatus =
  | "idle" // Initial state
  | "connecting" // Session init in progress
  | "waiting" // Waiting for user approval in Desktop App
  | "approved" // User approved, fetching grant
  | "complete" // Grant received
  | "error"; // Something went wrong
```

---

### 3. FRP Tunneling Infrastructure

**Purpose:** Make Desktop-bundled Personal Servers accessible from the internet

**Note:** Needs to be built from scratch.

#### Components

1. **Vana FRP Server**
   - Host: `proxy.server.vana.org`
   - Software: `frps` (Fast Reverse Proxy server)
   - VM: Dedicated instance on AWS/GCP/Fly.io

2. **DNS Configuration**
   - Wildcard A record: `*.server.vana.org` → FRP server IP
   - TLS: Wildcard certificate via Let's Encrypt

3. **Desktop App Integration** (separate effort)
   - Bundle `frpc` binary
   - Start tunnel on app launch
   - URL format: `https://{userId}.server.vana.org`
   - Register tunnel URL in DataPortabilityServers via Gateway

#### Tunnel Lifecycle

| Event                         | Action                                        |
| ----------------------------- | --------------------------------------------- |
| Desktop App opens             | Start frpc, establish tunnel                  |
| Tunnel established            | Register tunnel URL in DataPortabilityServers |
| Desktop App closes            | Tunnel terminates                             |
| Builder request while offline | Returns 503, or use ODL Cloud fallback        |

#### FRP Server Configuration (frps.ini)

```ini
[common]
bind_port = 7000
vhost_https_port = 443
subdomain_host = server.vana.org

dashboard_port = 7500
dashboard_user = admin
dashboard_pwd = <secure-password>

# TLS
tls_only = true
tls_cert_file = /path/to/wildcard.crt
tls_key_file = /path/to/wildcard.key
```

---

## What's NOT Needed in personal-server-ts

The Personal Server already has all the building blocks:

| Component                  | Location                                          | Status         |
| -------------------------- | ------------------------------------------------- | -------------- |
| Web3Signed auth            | `packages/core/src/auth/web3-signed.ts`           | ✅ Implemented |
| Grant verification         | `packages/server/src/middleware/grant-check.ts`   | ✅ Implemented |
| Builder registration check | `packages/server/src/middleware/builder-check.ts` | ✅ Implemented |
| Gateway client             | `packages/core/src/gateway/client.ts`             | ✅ Implemented |
| Data serving endpoints     | `packages/server/src/routes/data.ts`              | ✅ Implemented |

**No changes required to personal-server-ts for this flow to work.**

---

## Desktop App Requirements (Separate Effort)

The Desktop App needs these new features:

1. **Deep Link Handler**
   - Register `vana://` protocol
   - Parse `vana://connect?sessionId=xxx`

2. **Session Claim Flow**
   - Call Session Relay `POST /v1/session/claim`
   - Receive builder info and requested scopes

3. **Consent UI**
   - Display builder name, icon (from manifest)
   - Show requested scopes with descriptions
   - "Allow" / "Deny" buttons

4. **Grant Signing**
   - Generate EIP-712 typed data for grant
   - Sign with user's wallet

5. **Grant Submission**
   - Submit to Gateway (creates on-chain permissionId)
   - Submit to Session Relay `POST /v1/session/{id}/approve`

6. **frpc Integration** (Phase 3)
   - Bundle frpc binary
   - Auto-start on app launch
   - Register tunnel URL

---

## Implementation Phases

### Phase 1: Session Relay Service (1-2 weeks)

**Goal:** Enable session coordination between builders and Desktop App

**Tasks:**

1. Create `vana-com/session-relay` repository
2. Set up Hono project with TypeScript
3. Implement session state machine
4. Set up Neon PostgreSQL
5. Implement 4 API endpoints
6. Add Web3Signed verification (port from personal-server-ts)
7. Add builder registration check via Gateway
8. Deploy to Vercel
9. Set up monitoring/logging

**Deliverable:** Session Relay running at `session.vana.org`

---

### Phase 2: @vana/connect Package (1-2 weeks)

**Goal:** Provide builder SDK for easy integration

**Tasks:**

1. Create `vana-com/vana-connect` repository
2. Set up package structure (server + react)
3. Implement server-side session creation helper
4. Implement signing utilities
5. Create React hook (`useVanaConnect`)
6. Create pre-built components (`VanaConnectButton`, `VanaConnectModal`)
7. Write documentation and examples
8. Publish to npm

**Deliverable:** `@vana/connect` package on npm

---

### Phase 3: FRP Infrastructure (1-2 weeks, parallelizable)

**Goal:** Enable Desktop-only users to receive builder requests

**Tasks:**

1. Provision VM for FRP server
2. Install and configure `frps`
3. Set up wildcard DNS (`*.server.vana.org`)
4. Configure Let's Encrypt for TLS
5. Set up monitoring/alerting
6. Document frpc configuration for Desktop App team

**Deliverable:** FRP server at `proxy.server.vana.org`

---

### Phase 4: Desktop App Integration (Separate Team)

**Goal:** Complete the end-to-end flow

**Tasks:**

1. Implement deep link handler
2. Implement session claim flow
3. Build consent UI
4. Implement grant signing
5. Implement grant submission
6. Integrate frpc for tunneling

**Deliverable:** Desktop App supports "Connect Data" flow

---

## MVP Definition

**Minimum Viable Product = Phase 1 + Phase 2 + Phase 4**

This enables:

- Builders can integrate "Connect Data" buttons
- Users can approve access in Desktop App
- Builders receive grants and can fetch data

**Limitation:** Only works for users with ODL Cloud (hosted Personal Server). Desktop-only users need Phase 3 (FRP) to be accessible from the internet.

---

## Testing Strategy

### Session Relay Testing

- Unit tests for session state machine
- Integration tests with mocked Gateway
- E2E tests with Desktop App (manual initially)

### @vana/connect Testing

- Unit tests for server-side signing
- React component tests with React Testing Library
- Integration tests with Session Relay staging

### E2E Flow Testing

1. Register test builder via Desktop App
2. Create test app using @vana/connect
3. Complete flow: connect → consent → grant → data fetch
4. Verify access logs in Personal Server

---

## Security Considerations

1. **Session Relay**
   - Validate builder signature on session init
   - Check builder is registered via Gateway
   - Sessions expire after 15 minutes
   - Rate limit session creation per builder

2. **Grant Flow**
   - Grant signature includes nonce (replay protection)
   - Desktop App verifies builder manifest
   - User must explicitly approve

3. **FRP Tunneling**
   - TLS encryption for all traffic
   - frpc authentication token
   - Per-user subdomain isolation

---

## Open Questions

1. **Webhook reliability:** Should Session Relay retry failed webhooks? How many times?

2. **Session polling:** What's the recommended polling interval? Should we support WebSocket for real-time updates?

3. **Error UX:** What should builders show users when:
   - Desktop App is not installed?
   - User denies consent?
   - Session expires?

4. **Builder registration:** Should builders self-register via API, or always through Desktop App?

---

## References

- **Spec:** `docs/260121-data-portability-protocol-spec.md`
  - Section 4.5: Session Relay Service
  - Section 4.1.11: Internet Accessibility (Tunneling)
  - Section 6.3: "Connect Data" Flow
  - Section 6.6: Builder React Package (@vana/connect)
  - Appendix B.2: Builder Integration Scenario

- **Existing Code:**
  - `packages/core/src/auth/web3-signed.ts` - Auth verification
  - `packages/core/src/signing/request-signer.ts` - Request signing
  - `packages/core/src/gateway/client.ts` - Gateway client
