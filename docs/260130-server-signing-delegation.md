# Server Signing Delegation: Gateway Authentication for Personal Servers

**Date:** 2026-01-30
**Status:** Proposal

## 1. Problem Statement

The Personal Server needs to make authenticated POST requests to the Data Portability Gateway (file registration, grant creation). The Gateway authenticates these requests using EIP-712 signatures verified against the user's Ethereum address (`ownerAddress` / `grantorAddress`). However, the Personal Server does not — and cannot — hold the user's private key.

### Why the Personal Server doesn't have the private key

The user's wallet is a **Privy embedded wallet** managed by Data Connect (a Tauri desktop app). Privy's client-side embedded wallets are designed so that the private key is never accessible to the application code:

- Privy's `exportWallet()` opens a **user-facing modal** — the key is shown to the human, not returned to code
- The key is assembled on a **separate origin** so neither the app nor Privy can access it programmatically
- Server-side export exists but applies to **server-managed wallets**, not client-side embedded wallets

The `VANA_MASTER_KEY_SIGNATURE` that Data Connect provides to the Personal Server is an EIP-191 signature over `"vana-master-key-v1"` — a 65-byte blob used to:

1. **Recover** the owner's Ethereum address (via `recoverMessageAddress`)
2. **Derive** scope-specific encryption keys (via HKDF-SHA256)

It is **not a private key** and cannot be used to sign new messages.

## 2. Gateway Endpoints Requiring Authentication

The Data Gateway uses EIP-712 typed data signatures for all write operations. Every POST/DELETE sends the signature in:

```
Authorization: Signature 0x<65-byte-hex-signature>
```

The gateway recovers the signer from the EIP-712 signature and checks it matches the address in the request body. There is currently **no delegation** — only the exact address can sign.

### 2.1 Server Registration — `POST /v1/servers`

**Signed by:** `ownerAddress`
**Who does it:** Data Connect (Desktop App) — has the Privy wallet, signs directly.

```
EIP-712 Domain:
  name: "Vana Data Portability", version: "1"
  verifyingContract: DATA_PORTABILITY_SERVER_CONTRACT

Message (ServerRegistration):
  ownerAddress:  address   — user's wallet address
  serverAddress: address   — server's derived address
  publicKey:     string    — server's uncompressed public key (0x04...)
  serverUrl:     string    — server's URL
```

**Gateway verification:** `verifyServerRegistrationSignature(message, signature, ownerAddress)` — signer must be `ownerAddress`.

**No delegation needed.** Data Connect handles this directly.

### 2.2 File Registration — `POST /v1/files`

**Signed by:** `ownerAddress` (currently)
**Who needs to do it:** Personal Server — after encrypting and uploading data to storage backend (spec Section 4.1.8, step 9).

```
EIP-712 Domain:
  name: "Vana Data Portability", version: "1"
  verifyingContract: DATA_REGISTRY_CONTRACT

Message (FileRegistration):
  ownerAddress: address   — user's wallet address
  url:          string    — file URL on storage backend
  schemaId:     bytes32   — schema reference from DataRefinerRegistry
```

**Gateway verification:** `verifyFileRegistrationSignature(message, signature, ownerAddress)` — signer must be `ownerAddress`.

**Delegation needed.** The Personal Server runs autonomously (especially on Sprites.dev without a Desktop App) and must register files without the owner's private key.

### 2.3 Grant Creation — `POST /v1/grants`

**Signed by:** `grantorAddress` (currently)
**Who needs to do it:** Personal Server — when the user approves a grant via the server's UI or API.

```
EIP-712 Domain:
  name: "Vana Data Portability", version: "1"
  verifyingContract: DATA_PORTABILITY_PERMISSIONS_CONTRACT

Message (GrantRegistration):
  grantorAddress: address     — user's wallet address
  granteeId:      bytes32     — builder's ID
  grant:          string      — permission string (scopes, expiry)
  fileIds:        uint256[]   — file IDs included in grant
```

**Gateway verification:** `verifyGrantRegistrationSignature(message, signature, grantorAddress)` — signer must be `grantorAddress`.

**Gateway cross-checks before verification:**

- `granteeId` must reference an existing registered builder
- All `fileIds` must exist and be owned by `grantorAddress`

**Delegation needed.** For the same reasons as file registration — the Personal Server must be able to create grants autonomously, especially on Sprites.dev.

### 2.4 Grant Revocation — `DELETE /v1/grants/{grantId}`

**Signed by:** `grantorAddress`
**Who needs to do it:** Personal Server — when the user revokes a grant.

```
EIP-712 Domain:
  name: "Vana Data Portability", version: "1"
  verifyingContract: DATA_PORTABILITY_PERMISSIONS_CONTRACT

Message (GrantRevocation):
  grantorAddress: address   — user's wallet address
  grantId:        bytes32   — grant to revoke
```

**Delegation needed.** Same reasoning.

## 3. Proposed Solution: Server Signing Key Derivation + Gateway Delegation

### 3.1 Concept

```
                    Data Connect (Tauri)              Personal Server
                    ═══════════════════               ═══════════════
                    Has Privy wallet                  Has master key signature

Setup:              Signs "vana-master-key-v1" ──────▶ VANA_MASTER_KEY_SIGNATURE
                    ─────────────────────────          (65-byte EIP-191 signature)
                                                              │
                                                     keccak256(bytes) ──▶ 32-byte private key
                                                              │
                                                     privateKeyToAccount() ──▶ serverAddress
                    ◀──────────────────────────────────────────┘
                    Registers server on gateway:
                    POST /v1/servers {
                      ownerAddress, serverAddress,
                      publicKey, serverUrl
                    }
                    (signed by Privy wallet)

Runtime:                                             Signs file/grant requests
                                                     with derived key
                                                              │
                                                     POST /v1/files
                                                     Authorization: Signature 0x...
                                                     (signed by serverAddress)
                                                              │
                                                     Gateway checks:
                                                     1. Is signer == ownerAddress? ──▶ accept
                                                     2. Is signer a registered
                                                        serverAddress for owner? ──▶ accept
                                                     3. Neither ──▶ 401
```

### 3.2 Key Derivation

The Personal Server derives a signing key deterministically from the master key signature:

```typescript
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function deriveServerAccount(masterKeySignature: `0x${string}`) {
  const signatureBytes = deriveMasterKey(masterKeySignature); // existing: returns 65 raw bytes
  const privateKey = keccak256(signatureBytes); // hash to 32 bytes
  return privateKeyToAccount(privateKey); // viem PrivateKeyAccount
}
```

Properties:

- **Deterministic** — same signature always yields the same `serverAddress`
- **One-way** — cannot recover the original master key signature from the derived key
- **Not the owner's key** — the derived address is different from `ownerAddress`

### 3.3 Trust Chain

```
User's Privy Wallet (ownerAddress)
  │
  ├── signs "vana-master-key-v1" ──▶ master key signature (given to Personal Server)
  │
  └── signs ServerRegistration ──▶ gateway records: ownerAddress trusts serverAddress
                                    (on-chain via DataPortabilityServers)

Personal Server (serverAddress)
  │
  ├── signs FileRegistration ──▶ gateway accepts (serverAddress is registered for ownerAddress)
  └── signs GrantRegistration ──▶ gateway accepts (serverAddress is registered for ownerAddress)
```

The owner explicitly authorized the server address during registration. The gateway can verify this relationship exists on-chain.

## 4. Required Changes

### 4.1 Personal Server Changes

| File                                         | Change                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/keys/derive.ts`           | Add `deriveServerAccount()` — derives `PrivateKeyAccount` from master key signature                                                        |
| `packages/core/src/gateway/eip712.ts`        | **New file** — EIP-712 domains and types for `FileRegistration`, `GrantRegistration`, `GrantRevocation` (must match gateway's definitions) |
| `packages/core/src/gateway/client.ts`        | Add `registerFile()`, `createGrant()`, `revokeGrant()` methods with `Authorization: Signature` headers                                     |
| `packages/server/src/bootstrap.ts`           | Create `serverAccount` at startup via `deriveServerAccount(masterKeySignature)` and pass through deps                                      |
| `packages/core/src/schemas/server-config.ts` | Add `chainId` and `dataRegistryContract` / `dataPortabilityPermissionsContract` config fields                                              |

### 4.2 Gateway Changes

| File                         | Change                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `lib/eip712.ts`              | Add `recoverTypedDataSigner()` helper — recovers signer address without comparing to expected address               |
| `api/v1/files.ts`            | Add delegation fallback: if signer != `ownerAddress`, check if signer is a registered `serverAddress` for the owner |
| `api/v1/grants.ts`           | Same delegation fallback for grant creation: if signer != `grantorAddress`, check if signer is a registered server  |
| `api/v1/grants/[grantId].ts` | Same delegation fallback for grant revocation                                                                       |

### 4.3 Gateway Delegation Logic (applies to all delegated endpoints)

```typescript
// After existing verification fails:
if (!isValidSignature) {
  // Recover who actually signed
  const recoveredSigner = await recoverTypedDataSigner(
    domain,
    types,
    primaryType,
    message,
    signature,
  );

  if (recoveredSigner) {
    // Check if signer is a registered server for the owner
    const server = await db.query.servers.findFirst({
      where: and(
        eq(servers.ownerAddress, ownerAddressFromBody),
        eq(servers.serverAddress, recoveredSigner),
      ),
    });
    if (server) {
      isValidSignature = true;
    }
  }
}
```

This is a **fallback** — owner signatures continue to work. The delegation check only runs if the owner check fails.

## 5. Security Considerations

| Concern                 | Mitigation                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Derived key compromise  | Attacker can register files and create grants, but cannot register new servers or builders (requires owner's Privy wallet)            |
| Server impersonation    | Delegation only works for `serverAddress` values explicitly registered by the owner                                                   |
| Cross-user attacks      | Gateway checks `ownerAddress` ↔ `serverAddress` relationship per-user; a server derived from user A's signature cannot act for user B |
| Key rotation            | User generates new master key signature → new `serverAddress` → Data Connect re-registers the server                                  |
| Replay across endpoints | Each endpoint uses a different `verifyingContract` in the EIP-712 domain, preventing cross-endpoint replay                            |

## 6. Open Questions

1. **Should delegation be endpoint-specific?** Currently proposed as a uniform fallback for files, grants, and revocations. Could restrict to only file registration if grant creation should remain owner-only.

2. **Should the gateway record which address signed?** Currently the `signature` column stores the raw signature. Adding a `signerAddress` column would make the audit trail explicit (owner vs. server delegation).

3. **Rate limiting / abuse.** A compromised server key could spam file registrations. Should the gateway enforce per-server rate limits?
