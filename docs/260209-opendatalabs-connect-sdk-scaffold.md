# Implementation Plan: @opendatalabs/connect SDK + Personal Server Grant Endpoint

## Context

We need to build the `@opendatalabs/connect` SDK as a new NPM package (`vana-connect` repo), add a grant creation endpoint to the Personal Server, and update the spec. The Desktop App changes will happen separately.

Session Relay is deployed at: `https://session-relay-git-dev-opendatalabs.vercel.app/`
E2e reference: `session-relay/scripts/e2e/test-session-flow.ts` + `utils.ts`

---

## Stage 1: Scaffold vana-connect Repository

**Goal**: New repo at `/Users/kahtaf/Documents/workspace_vana/vana-connect` with CI/CD, OSS hygiene, and NPM publishing mirrored from `personal-server-ts`.

**Files to create**:

```
vana-connect/
├── .github/workflows/
│   ├── ci.yml                    # Lint + test on push/PR (from personal-server-ts)
│   ├── release.yml               # semantic-release on main (from personal-server-ts)
│   ├── prerelease.yml            # Canary on develop/feat/* (from personal-server-ts)
│   └── semantic-pull-request.yml # PR title validation (from personal-server-ts)
├── .husky/
│   ├── pre-commit                # npx lint-staged
│   └── commit-msg                # npx commitlint --edit $1
├── src/
│   ├── server/
│   │   ├── session-relay.ts      # createSessionRelay()
│   │   ├── request-signer.ts     # createRequestSigner()
│   │   ├── data-client.ts        # createDataClient()
│   │   └── index.ts
│   ├── react/
│   │   ├── useVanaConnect.ts     # Core polling hook
│   │   ├── ConnectButton.tsx     # Pre-built button
│   │   └── index.ts
│   ├── core/
│   │   ├── types.ts              # Shared types
│   │   ├── errors.ts             # ConnectError
│   │   └── index.ts
│   └── index.ts                  # Root re-exports
├── test/
│   ├── server/
│   │   ├── session-relay.test.ts
│   │   ├── request-signer.test.ts
│   │   └── data-client.test.ts
│   └── e2e/
│       └── test-app/             # E2E test app (see Stage 4)
├── package.json
├── tsconfig.json
├── tsconfig.base.json
├── vitest.config.ts
├── eslint.config.js
├── .prettierrc
├── .editorconfig
├── .gitignore
├── .releaserc.yaml
├── commitlint.config.js
├── LICENSE                       # MIT, OpenDataLabs
├── CONTRIBUTING.md
└── README.md
```

**package.json** (key fields):

```json
{
  "name": "@opendatalabs/connect",
  "version": "0.0.1",
  "type": "module",
  "publishConfig": { "access": "public" },
  "files": ["dist"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./server": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.js"
    },
    "./react": {
      "types": "./dist/react/index.d.ts",
      "import": "./dist/react/index.js"
    },
    "./core": {
      "types": "./dist/core/index.d.ts",
      "import": "./dist/core/index.js"
    }
  },
  "peerDependencies": {
    "viem": "^2.0.0",
    "react": ">=18.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true },
    "viem": { "optional": true }
  },
  "devDependencies": {
    "typescript": "~5.7.0",
    "vitest": "^4.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.8.0",
    "viem": "^2.45.0",
    "react": "^19.0.0",
    "@types/react": "^19.0.0",
    "husky": "^9.0.0",
    "lint-staged": "^16.0.0",
    "@commitlint/cli": "^19.0.0",
    "@commitlint/config-conventional": "^19.0.0",
    "semantic-release": "^25.0.0"
  }
}
```

**tsconfig** pattern: Same as personal-server-ts (`ES2022`, `Node16`, strict, composite, declaration maps).

**Tests**: Co-located pattern from personal-server-ts but also a `test/` directory for integration/e2e.

---

## Stage 2: Implement Server-Side SDK

**Goal**: `@opendatalabs/connect/server` — session relay client, request signer, data client.

### 2.1 `src/server/request-signer.ts`

Reimplement Web3Signed header generation from `personal-server-ts/packages/core/src/signing/request-signer.ts`:

- `createRequestSigner({ privateKey })` factory
- `signer.signRequest({ aud, method, uri, body?, grantId? })` → `"Web3Signed {base64url}.{sig}"`
- JSON canonicalization (sort keys, exclude `signature`)
- SHA-256 body hash
- Base64url encoding (no padding)
- EIP-191 signing via viem `privateKeyToAccount().signMessage()`

Also reference `session-relay/scripts/e2e/utils.ts` which has a clean standalone implementation of the same pattern.

### 2.2 `src/server/session-relay.ts`

```typescript
export function createSessionRelay(config: {
  privateKey: string;
  granteeAddress: string;
  sessionRelayUrl: string;
});
```

Methods:

- `initSession(params: SessionInitParams)`: Signs request with Web3Signed, `POST /v1/session/init`, returns `{ sessionId, deepLinkUrl, expiresAt }`
- `pollSession(sessionId: string)`: `GET /v1/session/{id}/poll`, returns `{ status, grant?, reason? }`
- `pollUntilComplete(sessionId: string, opts?: { interval, timeout })`: Polls in a loop until approved/denied/expired

### 2.3 `src/server/data-client.ts`

```typescript
export function createDataClient(config: {
  privateKey: string;
  gatewayUrl: string;
});
```

Methods:

- `resolveServerUrl(userAddress: string)`: `GET /v1/servers/{address}` on Gateway, returns `serverUrl`
- `fetchData(params: DataFetchParams)`: Signs with Web3Signed + grantId, `GET /v1/data/{scope}` on Personal Server
- `listScopes(params: { serverUrl })`: Signs with Web3Signed (no grantId), `GET /v1/data` on Personal Server
- `listVersions(params: { serverUrl, scope })`: `GET /v1/data/{scope}/versions`

### 2.4 Unit Tests

- `request-signer.test.ts`: Verify header format, payload canonicalization, base64url encoding, signature recovery matches signer address
- `session-relay.test.ts`: Mock fetch, verify correct URLs/headers/bodies for init/poll
- `data-client.test.ts`: Mock fetch, verify Web3Signed headers, grantId inclusion, Gateway resolution

---

## Stage 3: Implement React Client SDK

**Goal**: `@opendatalabs/connect/react` — polling hook and pre-built button.

### 3.1 `src/react/useVanaConnect.ts`

```typescript
export function useVanaConnect(config: {
  sessionRelayUrl: string;
  pollingInterval?: number; // default 2000ms
}): {
  connect: (params: { sessionId: string }) => Promise<void>;
  status: ConnectionStatus;
  grant: GrantPayload | null;
  error: string | null;
  deepLinkUrl: string | null;
  reset: () => void;
};
```

- Calls `GET /v1/session/{id}/poll` (no auth needed, browser-safe)
- Manages polling lifecycle with `setInterval` + cleanup
- Status transitions: `idle → connecting → waiting → approved|denied|expired|error`
- Returns `deepLinkUrl` constructed from sessionId (for "Open Desktop App" link)
- Auto-stops polling on terminal states

### 3.2 `src/react/ConnectButton.tsx`

Pre-built component wrapping `useVanaConnect`:

- Props: `sessionId, sessionRelayUrl, onComplete, onError, onDenied, className?, label?`
- Default styling (minimal, overridable)
- Shows status text and deep link

---

## Stage 4: E2E Test Application

**Goal**: A test app in `test/e2e/test-app/` that exercises the SDK like a real builder would. Uses the same patterns as `session-relay/scripts/e2e/test-session-flow.ts`.

### 4.1 Structure

```
test/e2e/
├── test-connect-flow.ts    # Full E2E: init → poll → (mock approve) → fetch data
├── utils.ts                # Reuse pattern from session-relay e2e utils
└── vitest.config.ts        # Separate vitest config for e2e
```

### 4.2 Test Flow

```typescript
// test-connect-flow.ts
import {
  createSessionRelay,
  createDataClient,
  createRequestSigner,
} from "../../src/server/index.js";

// 1. Register builder with Gateway (if config available)
// 2. Create session via SDK
const relay = createSessionRelay({
  privateKey: BUILDER_PRIVATE_KEY,
  granteeAddress: builderAccount.address,
  sessionRelayUrl: SESSION_RELAY_URL,
});
const session = await relay.initSession({
  scopes: ["test.data.read"],
});
assert(session.sessionId);
assert(session.deepLinkUrl.includes("secret="));

// 3. Poll — should be pending
const pending = await relay.pollSession(session.sessionId);
assert(pending.status === "pending");

// 4. Simulate Desktop App: claim + approve (using raw fetch like session-relay e2e)
const deepLink = new URL(session.deepLinkUrl);
const secret = deepLink.searchParams.get("secret")!;
await fetch(`${SESSION_RELAY_URL}/v1/session/claim`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId: session.sessionId, secret }),
});
await fetch(`${SESSION_RELAY_URL}/v1/session/${session.sessionId}/approve`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    secret,
    grantId: `test-grant-${Date.now()}`,
    userAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    scopes: ["test.data.read"],
  }),
});

// 5. Poll — should be approved with grant
const approved = await relay.pollSession(session.sessionId);
assert(approved.status === "approved");
assert(approved.grant?.grantId);

// 6. Test request signing (verify format is correct)
const signer = createRequestSigner({ privateKey: BUILDER_PRIVATE_KEY });
const authHeader = await signer.signRequest({
  aud: "https://test.server.vana.org",
  method: "GET",
  uri: "/v1/data/test.data.read",
  grantId: approved.grant.grantId,
});
assert(authHeader.startsWith("Web3Signed "));
assert(authHeader.includes(".0x")); // payload.signature format
```

### 4.3 Environment

```bash
# .env for e2e tests
SESSION_RELAY_URL=https://session-relay-git-dev-opendatalabs.vercel.app
GATEWAY_URL=https://data-gateway-env-dev-opendatalabs.vercel.app
BUILDER_PRIVATE_KEY=0x...  # Generated per test run
```

**npm script**: `"test:e2e": "vitest run --config test/e2e/vitest.config.ts"`

---

## Stage 5: Personal Server — Grant Creation Endpoint

**Goal**: New `POST /v1/grants` endpoint on Personal Server that the Desktop App calls to create grants. The PS signs the grant and submits to Gateway.

### 5.1 New Route: `packages/server/src/routes/grants.ts`

Add to existing grants router:

```typescript
// POST /v1/grants — Create a grant (owner-only)
// Desktop App calls this; Personal Server signs + submits to Gateway
grants.post("/", ownerCheck, async (c) => {
  const body = await c.req.json();
  // Validate: { granteeAddress, scopes, expiresAt?, nonce? }

  // 1. Look up builder to get builderId
  const builder = await gateway.getBuilder(body.granteeAddress);
  if (!builder) throw new UnregisteredBuilderError();

  // 2. Sign EIP-712 GrantRegistration
  const grantPayload = JSON.stringify({
    user: serverOwner,
    builder: body.granteeAddress,
    scopes: body.scopes,
    expiresAt: body.expiresAt ?? 0,
    nonce: body.nonce ?? Date.now(),
  });

  const signature = await serverSigner.signGrantRegistration({
    grantorAddress: serverOwner,
    granteeId: builder.id,
    grant: grantPayload,
    fileIds: [], // No file IDs for now
  });

  // 3. Submit to Gateway
  const result = await gateway.createGrant({
    grantorAddress: serverOwner,
    granteeId: builder.id,
    grant: grantPayload,
    fileIds: [],
    signature,
  });

  return c.json({ grantId: result.grantId }, 201);
});
```

### 5.2 Files to Modify

- `packages/server/src/routes/grants.ts` — Add POST handler
- `packages/core/src/gateway/client.ts` — Verify `createGrant()` works for this use case (it already exists)
- `packages/core/src/signing/eip712.ts` — Verify `GRANT_REGISTRATION_TYPES` matches Gateway expectations

### 5.3 `verifyingContract` Fix

The Personal Server currently uses zero address in `packages/core/src/grants/eip712.ts`. For Gateway submission, it must use the real contract address. Options:

- Make `verifyingContract` configurable via env/config (recommended)
- Add `DATA_PORTABILITY_PERMISSIONS_CONTRACT` to server config

Check `packages/core/src/signing/eip712.ts` — it may already use a configurable domain. The Gateway client's `createGrant()` method in `packages/core/src/gateway/client.ts` already handles the signature — verify it uses the right domain.

### 5.4 Tests

- Unit test for new POST handler with mocked gateway
- Verify EIP-712 signature format matches what Gateway expects

---

## Stage 6: Update Spec

**Goal**: Update `docs/260121-data-portability-protocol-spec.md` and `docs/260203-sign-in-with-vana-implementation-plan.md`.

### Changes to spec:

1. **Section 4.5** (Session Relay): Add `secret` parameter to claim/approve, document deny endpoint, update deep link format to `vana://connect?sessionId=xxx&secret=yyy`
2. **Section 6.3** (Connect Data Flow): Update to show Personal Server signing grants (not Desktop App)
3. **Section 6.6** (@vana/connect): Rename to `@opendatalabs/connect`, update package structure and API examples
4. **Section 4.1.5** (Personal Server API): Add `POST /v1/grants` endpoint for grant creation

### Changes to implementation plan:

1. Update repo/package names to `@opendatalabs/connect`
2. Note that Personal Server signs grants
3. Reference actual Session Relay implementation (claim secret, deny endpoint)

---

## Verification Plan

### Unit Tests (vana-connect)

```bash
cd /Users/kahtaf/Documents/workspace_vana/vana-connect
npm test
```

- Request signer produces valid Web3Signed headers
- Session relay client calls correct endpoints with correct shapes
- Data client signs requests and resolves server URLs

### E2E Test (vana-connect → Session Relay)

```bash
SESSION_RELAY_URL=https://session-relay-git-dev-opendatalabs.vercel.app npm run test:e2e
```

- Full flow: init → poll (pending) → claim → approve → poll (approved with grant)

### Personal Server Tests

```bash
cd /Users/kahtaf/Documents/workspace_vana/personal-server-ts
npm test
```

- New POST /v1/grants endpoint creates grant via Gateway
- Owner-only auth enforced

### Lint/Format

```bash
cd /Users/kahtaf/Documents/workspace_vana/vana-connect
npm run validate  # lint + format:check + test
```
