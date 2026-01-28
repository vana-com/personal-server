# Vana Data Portability Protocol Specification

## **Table of Contents**

 1. [Introduction](<#1-introduction>)
 2. [Terminology](<#2-terminology>)
 3. [Protocol Model](<#3-protocol-model>)
4. [Protocol Components](<#4-protocol-components>)
    * [4.1.6 Personal Server Implementation Targets](<#416-personal-server-implementation-targets>)
    * [4.1.7 Data Sync Component](<#417-data-sync-component>)
    * [4.1.8 Local Data Hierarchy](<#418-local-data-hierarchy>)
    * [4.1.9 Builder Data Access Interface](<#419-builder-data-access-interface>)
    * [4.1.10 MCP Server Integration](<#4110-mcp-server-integration>)
    * [4.1.11 Internet Accessibility (Tunneling)](<#4111-internet-accessibility-tunneling>)
    * [4.5 Session Relay Service](<#45-session-relay-service>)
 5. [Data Formats](<#5-data-formats>)
 6. [Protocol Operations](<#6-protocol-operations>)
    * [6.6 Builder React Package (@vana/connect)](<#66-builder-react-package-vana-connect>)
 7. [Security Considerations](<#7-security-considerations>)
 8. [Error Handling](<#8-error-handling>)
 9. [Extensibility](<#9-extensibility>)
10. [Appendix A: Alignment Analysis](<#appendix-a-alignment-analysis>)
11. [Appendix B: Complete Flow Scenarios](<#appendix-b-complete-flow-scenarios>)
12. [Appendix C: SMTP Analogy Mapping](<#appendix-c-smtp-analogy-mapping>)
13. [Appendix D: ODL Cloud Reference Architecture](<#appendix-d-vana-cloud-reference-architecture>)

---

## **1. Introduction**

### **1.1 Purpose**

The Data Portability Protocol (DP) enables users to:

1. Collect their personal data from various platforms
2. Store that data under their control
3. Grant third-party applications access to specific data scopes
4. Revoke access at any time
5. Maintain an auditable record of all data access

### **1.2 Design Principles**

1. **User Sovereignty** — User controls their data and who accesses it
2. **Local-First** — Data stored on user's device by default
3. **Protocol-Native** — Grants and data registry entries on-chain for verifiability
4. **Encryption by Default** — Data encrypted before upload to the storage backend; TLS in transit
5. **Extensibility** — New data sources and storage backends can be added

### **1.3 Scope**

This specification covers:

* Protocol entities and their roles
* Data formats and schemas
* Grant operations (create, revoke, verify)
* Storage operations (write, read, delete)
* Identity and authentication
* Error handling

This specification does NOT cover:

* Data connector implementations (platform-specific scrapers)
* Application-specific features (search, vector DB, AI integration)
* User interface design

---

## **2. Terminology**

### **2.1 Protocol Entities**

**User** : A human who owns data and controls access to it. Identified by a cryptographic wallet address.

**Data Portability Client** : Software that enables users to interact with the protocol. Analogous to an email client. The Vana Desktop App is the reference implementation. NOT a protocol participant (not registered on-chain). It may bundle a Personal Server; in that case the Personal Server (not the client) is the protocol participant and must be registered on-chain.

**Personal Server** : A protocol-recognized environment integrated with user storage which responds to access requests and offers to certain compute operations on user data. Registered on-chain. 

**Builder** : A third-party application that requests access to user data. Registered on-chain (via Desktop App + Gateway relayer) with a public key and an app URL used to resolve app metadata.

**Data Portability RPC (Gateway)** : A service that provides fast API access to protocol operations with eventual chain consistency. May be operated by Vana or federated providers.

**Passport (Client-side)** : A client-chosen UX layer that authenticates users and manages wallets on their behalf, abstracting wallet concepts from web2 users. Passport is NOT a protocol component; from the protocol POV, only wallet addresses matter. The Desktop App uses Privy for Passport today, but other clients may use different vendors.

**Storage Backend** : A service that stores encrypted data blobs. Can be Vana Storage, IPFS, user's cloud (Google Drive, Dropbox), or local storage.

### **2.2 Protocol Objects**

**Data File** : An encrypted blob containing user data for a specific scope. File contents are immutable after write; on-chain `fileId` linkage is tracked in the Personal Server's local index.

**DataRegistry File Record** : An on-chain registry entry (fileId, URL, schemaId, permissions) that points to an encrypted Data File in a storage backend. `schemaId` is REQUIRED for all file records. `fileId` is assigned when the record is written on-chain.

**Grant** : A signed permission allowing a Builder to access specific data scopes.

**Scope** : A hierarchical identifier for a type of data (e.g., `instagram.profile`, `chatgpt.conversations`). Scope is always the full path; `source` is derived from the first segment.

**Data Connector** : A module that extracts data from a specific platform. Implementation-specific, not part of the protocol.

**Schema Registry (DataRefinerRegistry)** : On-chain registry mapping `schemaId` → schema definition (IPFS CID/URL) used to resolve canonical scope prior to decryption.

### **2.3 Cryptographic Primitives**

**Grant Signature** : An EIP-712 typed data signature proving user consent.

**Key Derivation** :
* **Master key material** = raw signature bytes produced by EIP-191 `personal_sign` over the fixed message `"vana-master-key-v1"`.
* **Scope key** = `HKDF-SHA256(master_key_material, "vana", "scope:{scope}")` (32 bytes output).

---

## **3. Protocol Model**

### **3.1 Architecture Overview**

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              APPS LAYER                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Builder App 1   │  │ Builder App 2   │  │ Vana Trace      │             │
│  │ (e.g. Flipboard)│  │                 │  │ (First-party)   │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
│           │Connect data        │                    │                      │
└───────────┼────────────────────┼────────────────────┼──────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           PROTOCOL LAYER                                   │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Personal Server (Protocol Participant)                             │   │
│  │  - Arbitrary compute over user data                                 │   │
│  │  - Syncs data to storage backends                                   │   │
│  │  - Serves builders + enforces grants                                │   │
│  │  - Hosted (ODL Cloud) or self-hosted                                │   │
│  │                                                                     │   │
│  │  Storage Adapter: Vana Storage, IPFS, Google Drive, Dropbox         │   │
│  │  Compute: LLMs/agents, data transformations                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Storage Backends                                                   │   │
│  │  - Vana Storage (default)                                           │   │
│  │  - IPFS                                                             │   │
│  │  - Google Drive                                                     │   │
│  │  - Dropbox                                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Data Portability RPC (Gateway)                                     │   │
│  │  - Fast reads/writes (cached)                                       │   │
│  │  - Async chain sync                                                 │   │
│  │  - May be federated                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Vana L1 (Source of Truth)                                          │   │
│  │  - File Registry (DataRegistry)                                     │   │
│  │  - Permissions/Grants (DataPortabilityPermissions)                  │   │
│  │  - Builder Registry (DataPortabilityGrantees)                       │   │
│  │  - Personal Server Registry (DataPortabilityServers)                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
            ▲
            │
┌───────────┴────────────────────────────────────────────────────────────────┐
│                    DATA PORTABILITY CLIENT                                 │
│                    (Desktop App - NOT a protocol participant;              │
│                     may bundle a Personal Server)                          │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Passport (Privy or other)                                           │   │
│  │ - Manages user wallet + maps to on-chain address                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Bundled Personal Server (protocol participant; same interface)      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Data Connectors (NOT part of protocol)                              │   │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │   │
│  │ │Instagram │ │ ChatGPT  │ │ YouTube  │ │  Gmail   │                 │   │
│  │ └──────────┘ └──────────┘ └──────────┘ └──────────┘                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Local Storage (Unencrypted, user's device only)                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

### **3.2 Key Distinction: Client vs Participant**

**Why this matters:** The Desktop App configures and controls the Personal Server, but the Personal Server is what participates in the protocol. This remains true even when the Personal Server is bundled inside the Desktop App (the server is registered on-chain; the app is not). Multiple Desktop Apps (or mobile apps, or CLI tools) can control the same Personal Server.

---

## **4. Protocol Components**

### **4.1 Personal Server**

#### **4.1.1 Purpose**

A protocol-recognized environment that:

* Stores user data in plain text, ready to process
* Responds to authorized data requests from Builders
* Maintains access logs
* Can operate unattended (without user actively present)

#### **4.1.2 Registration**

Personal Server MUST be registered on-chain via `DataPortabilityServers` (see Section **4.3.1**). Registration and trust relationships use EIP-712 signature-based operations (e.g., `addAndTrustServerWithSignature`).

#### **4.1.3 Hosting Options**

| **Option** | **URL Format** | **Operator** | **Data Visibility** |
| -- | -- | -- | -- |
| Vana-Hosted | `https://server.vana.com/u/{userId}` | Vana | Unencrypted OK |
| Self-Hosted | `https://server.alice.com` | User | Unencrypted OK (user's security zone) |
| Desktop-Bundled | Local server within Desktop App | User's device | Unencrypted OK (user's security zone) |
| Desktop-as-Server (tunneled) | `https://{userId}.server.vana.org` | User's device | Unencrypted OK (user's security zone) |

#### **4.1.4 Encryption Requirements (Implementation-Specific)**

The protocol is NOT opinionated about whether the Personal Server stores data encrypted or unencrypted at rest.

**Protocol Requirements (ALL implementations MUST):**

* Encrypt data **in transit** (TLS 1.3)
* Verify grant validity before serving data

**Desktop-Bundled Personal Server:**

The Desktop App MAY bundle a Personal Server implementation that:

* Stores data unencrypted locally (within user's security zone)
* Runs computations on unencrypted data
* Is only available when the Desktop App is running

The bundled Personal Server is still a Personal Server and MUST be registered on-chain; the Desktop App submits the registration on the user's behalf.

```
┌─────────────────────────────────────────────────────────────────┐
│  USER'S DEVICE (Security Zone)                                  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Desktop App                                             │   │
│  │  ├── Data Connectors (scraping)                          │   │
│  │  └── Bundled Personal Server                             │   │
│  │       ├── Local Storage (unencrypted OK)                 │   │
│  │       ├── Serves decrypted data to authorized builders   │   │
│  │       ├── Runs local computations                        │   │
│  │       └── Serves builders (when app is open)             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Data never leaves user's security zone in plaintext            │
└─────────────────────────────────────────────────────────────────┘
```

Users MAY configure both:

* Desktop-Bundled for local compute and when app is open
* Vana-Hosted as fallback when app is closed

#### **4.1.5 Personal Server API**

```
POST /v1/data/{scope}
  Create a new data document for the specified scope
  Headers:
    Content-Type: application/json (only JSON documents supported for now)
  Body:
    Raw JSON data payload (the "data" field content only)
GET /v1/data
  List available scopes and latest version metadata
  Query params:
    ?scopePrefix={scopePrefix}   # optional filter by scope prefix
    ?limit={limit}               # optional pagination
    ?offset={offset}             # optional pagination
GET /v1/data/{scope}
  Read data file (user-initiated; or builder-initiated with grantId + Web3Signed Authorization)
  Query params:
    ?fileId={fileId}        # specific version by DataRegistry fileId
    ?at={ISO8601}           # specific version by collectedAt (closest <= at)
    (default: latest by collectedAt)
GET /v1/data/{scope}/versions
  List available versions (metadata only)
  Query params:
    ?limit={limit}               # optional pagination
    ?offset={offset}             # optional pagination
DELETE /v1/data/{scope}
  Delete data file
GET /v1/grants
  List all grants for this user
POST /v1/grants/verify
  Verify a grant signature
GET /v1/access-logs
  Get access log history
GET /health
  Health check (unversioned)
```

**POST /data/{scope} (plaintext ingest):**

* Personal Server MUST:
  1. Look up the `schemaId` for the given scope via Gateway (`GET /v1/schemas?scope={scope}`).
  2. Reject with `400 Bad Request` if no schema is registered for the scope.
  3. Validate the request body against the schema definition.
  4. Reject with `400 Bad Request` if validation fails.
  5. Generate `collectedAt` timestamp (current UTC time).
  6. Construct the full Data File envelope:
     ```json
     {
       "$schema": "<schema URL from registry>",
       "version": "1.0",
       "scope": "{scope}",
       "collectedAt": "<generated timestamp>",
       "data": <request body>
     }
     ```
  7. Store locally in `~/.vana/data/{scope}/{collectedAt}.json`.
  8. Return `201 Created` immediately with the response below.
  9. Async (background): encrypt the Data File, upload to the configured storage backend (if any), and register the file record in `DataRegistry` via DP RPC.

**POST /data/{scope} Response:**

```json
{
  "scope": "instagram.profile",
  "collectedAt": "2026-01-21T10:00:00Z",
  "status": "syncing"
}
```

**Authentication Model (Builder Data Requests)**

* Builder data requests MUST include `Authorization: Web3Signed ...` (see **4.1.9** and **4.1.9.1**).
* The Web3Signed payload MUST include `grantId` (permissionId) when raw data is requested.
* Personal Server recovers the signer address from the `Authorization` header and verifies it matches the on-chain grantee for the provided `grantId`.

**Authentication Model (Builder Non-Data Requests)**

For builder calls that do NOT return raw data (e.g., `/data`, `/data/{scope}/versions`), the Personal Server MUST require a signed request but MUST NOT require a grant.

* Builder MUST include `Authorization: Web3Signed ...` (see **4.1.9.1**).
* Personal Server verifies the recovered signer is a registered Builder on-chain.
* Personal Server enforces `iat`/`exp` time bounds (and MAY cache signatures to reduce replay).

**Access Control for Data Endpoints**

* `/grants` endpoints are user-initiated actions (Desktop App or Personal Server UI) and MUST NOT be callable by Builders.
* `GET /data/{scope}` MAY be user-initiated OR builder-initiated when a valid grant is provided (see **4.1.9**).
* `DELETE /data/{scope}` is a user-only action for removing local/decrypted data and triggering storage cleanup in the storage backend.
* `GET /data` and `GET /data/{scope}/versions` MAY be builder-initiated but require `Authorization: Web3Signed ...` per **4.1.9.1**.

#### **4.1.6 Personal Server Implementation Targets**

The Personal Server is designed to be portable across multiple deployment targets. All implementations MUST expose the same API surface and enforce grants identically.

| **Target** | **Runtime** | **Activation** | **Availability** | **Key Derivation** |
| -- | -- | -- | -- | -- |
| Desktop-Bundled | Embedded in Tauri app | User opens app | While app is running | User signs on app open |
| ODL Cloud | Firecracker MicroVM (Sprites.dev) | HTTP request auto-activates | Always (cold start \~1s) | Delegated signature (never expires) |
| Self-Hosted | Docker container | Always running | User manages | User's choice |

**Note:** The Personal Server does NOT require the user's wallet private key. It only needs the master-key signature (the signature over `"vana-master-key-v1"`) to derive keys. Implementations MAY supply this at startup via an env var such as `VANA_MASTER_KEY_SIGNATURE`, or store it encrypted in Sprite storage for ODL Cloud.

**ODL Cloud (Sprites.dev) Details:**

ODL Cloud uses [Sprites.dev](<https://sprites.dev>) to provide stateful, per-user MicroVMs:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ODL CLOUD ARCHITECTURE                                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Sprites Orchestrator (managed by Vana)                                 ││
│  │  - Provisions one Sprite per user on-demand                             ││
│  │  - Auto-scales to 0 when inactive (stops billing)                       ││
│  │  - Persists data to durable storage between activations                 ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Per-User Sprite (Firecracker MicroVM)                                  ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐││
│  │  │  Personal Server Process                                            │││
│  │  │  - Decrypts data on activation (delegated signature stored)         │││
│  │  │  - Stores decrypted data in ~/.vana/data/{scope}/                   │││
│  │  │  - Serves builder data requests                                     │││
│  │  │  - Serves builder requests via HTTP (port 8080)                     │││
│  │  │  - Serves decrypted data to authorized builders                     │││
│  │  └─────────────────────────────────────────────────────────────────────┘││
│  │                                                                         ││
│  │  Resources: Up to 8 CPUs, 16GB RAM, 100GB+ storage                      ││
│  │  URL: https://{user-id}.server.vana.com → proxied to Sprite port 8080   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  COLD START BEHAVIOR:                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  1. Builder calls: GET https://user-abc.server.vana.com/data            ││
│  │  2. Sprites edge sees Sprite inactive → assigns compute (~300ms)        ││
│  │  3. Sprite boots with persisted filesystem                              ││
│  │  4. Personal Server starts, decrypts data using delegated signature     ││
│  │  5. Request proxied to port 8080, response returned                     ││
│  │  6. After idle timeout → Sprite sleeps (billing stops, data persists)   ││
│  │                                                                         ││
│  │  Total cold start latency: ~1-2 seconds                                 ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Delegated Signature (for Unattended Access):**

When a user enables ODL Cloud, they sign a message that is stored encrypted in the Sprite's persistent storage. This signature NEVER expires and is used to derive the master key on each activation:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DELEGATED SIGNATURE FLOW                                                   │
│                                                                             │
│  SETUP (one-time, in Desktop App):                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  1. User clicks "Enable ODL Cloud" in Desktop App                       ││
│  │  2. Desktop App prompts: "Sign to authorize your cloud server"          ││
│  │  3. User signs message: "vana-master-key-v1" via EIP-191 personal_sign  ││
│  │  4. Desktop App provisions Sprite via ODL Cloud API                     ││
│  │  5. Signature encrypted with Sprite-specific key, stored in Sprite      ││
│  │  6. Sprite URL registered in DataPortabilityServers on-chain            ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ACTIVATION (every cold start):                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  1. HTTP request activates Sprite                                       ││
│  │  2. Personal Server reads encrypted signature from persistent storage   ││
│  │  3. Decrypts signature (Sprite has decryption key)                      ││
│  │  4. Derives master key: HKDF(signature, "vana", "master")               ││
│  │  5. Derives scope keys, decrypts user data files                        ││
│  │  6. Server ready to handle requests                                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  SECURITY PROPERTIES:                                                       │
│  • Signature never expires (user authorizes once, stored forever)           │
│  • Signature encrypted at rest in Sprite storage                            │
│  • Master key material derived in-memory, never persisted                   │
│  • User can revoke by deleting Sprite (via Desktop App)                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Note:** The delegated signature is sufficient for key derivation; the Personal Server never loads or uses a user wallet private key.

**Sprite Provisioning (On-Demand):**

Sprites are NOT provisioned for all users automatically. They are provisioned only when a user explicitly enables "unattended access" or "ODL Cloud":

| **Trigger** | **Action** |
| -- | -- |
| User creates account | NO Sprite provisioned (Desktop-only) |
| User enables "ODL Cloud" | Sprite provisioned, signature stored |
| User disables "ODL Cloud" | Sprite deleted, data remains in storage backend |

#### **4.1.7 Data Sync Component**

The Personal Server includes a Data Sync component that manages the flow of data between the storage backend and local storage. The storage backend is the source of truth for encrypted data; Personal Servers maintain local decrypted copies for compute and serving. Decryption requires the canonical scope, which is resolved from `schemaId` via the Gateway schema lookup.

**DP RPC deployment constraint:** The DP RPC runs on Vercel Serverless and does not support streaming. Personal Servers MUST poll for new file records using a `lastProcessedTimestamp` cursor (not block-based backfill).
The `lastProcessedTimestamp` is cached locally by the Personal Server and used when querying DP RPC; if the timestamp is not provided, DP RPC returns all file records for the user.

**Storage Backend Selection:**

Users select ONE storage backend for all their data (per-user, not per-file). Selection happens during Desktop App sign-in and is persisted in `~/.vana/server.json`. Until a storage backend is selected, the Personal Server operates in local-only mode and does NOT write to `DataRegistry`.

When a storage backend is selected or changed, the Personal Server bulk-uploads existing local data to the new backend and registers corresponding `DataRegistry` file records on-chain (triggered/configured by the Desktop App).

| **Backend** | **URL Format** | **Notes** |
| -- | -- | -- |
| Vana Storage (default) | `vana://storage/{userId}/{fileId}` | Managed by Vana, no setup |
| Google Drive | `gdrive://{fileId}` | User authorizes via OAuth |
| Dropbox | `dropbox://{path}` | User authorizes via OAuth |
| IPFS | `ipfs://{cid}` | Content-addressed |

**Data Flow (Storage-First Model):**

After a storage backend is selected, all new data goes to the storage backend FIRST, then syncs to all Personal Server instances:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DATA SYNC FLOW                                                             │
│                                                                             │
│  NEW DATA (from Desktop connector):                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  1. Desktop App collects data via connector (Instagram, etc.)           ││
│  │  2. Desktop App sends raw data to Personal Server                        ││
│  │  3. Personal Server stores locally unencrypted: ~/.vana/data/{scope}/    ││
│  │  4. Personal Server encrypts data with scope key                         ││
│  │  5. Encrypted blob uploaded to storage backend (Vana/GDrive/Dropbox)     ││
│  │  6. File record registered in DataRegistry via DP RPC (schemaId required)││
│  │  7. DP RPC records file metadata (schemaId attached)                     ││
│  │  8. Other Personal Servers poll DP RPC for new file records since lastProcessedTimestamp ││
│  │  9. Other Personal Servers download → resolve schemaId → decrypt → store ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  PERSONAL SERVER SETUP (first activation):                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  1. Personal Server activates (Desktop open OR Sprite cold start)       ││
│  │  2. Query DP RPC for all file records for this user                     ││
│  │  3. Query DP RPC for file records since lastProcessedTimestamp          ││
│  │  4. For each file record:                                               ││
│  │     a) Download encrypted blob from storage backend                     ││
│  │     b) Resolve schemaId → canonical scope (via Gateway /v1/schemas)     ││
│  │     c) Decrypt with scope key (derived from master key material)        ││
│  │     d) Read scope/collectedAt from payload                              ││
│  │     e) Store in ~/.vana/data/{scope}/{collectedAt}.json                 ││
│  │     f) Update local index (fileId → path, scope, collectedAt)           ││
│  │  5. Mark sync complete, server ready to serve requests                  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  MULTI-INSTANCE SYNC (Desktop + ODL Cloud):                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Source of Truth: Storage Backend + Data Registry (via DP RPC)          ││
│  │                                                                         ││
│  │  • Each Personal Server polls DP RPC for new file records               ││
│  │  • On new fileId: download → resolve schemaId → decrypt → index → write ││
│  │  • On restart: resume from lastProcessedTimestamp                       ││
│  │  • Conflict resolution: last-write-wins (collectedAt in payload)        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

Before a storage backend is selected, steps 4–9 are skipped: data remains local-only and no DataRegistry entries are created.

When a file record is registered on-chain, the Data Sync component records the `fileId` in the local index (mapping to the immutable local file). The data file itself is never mutated post-registration.

**Local Sync Index (Personal Server):**

Personal Servers maintain a local index to avoid duplicate downloads and to support fast hierarchy lookups. Minimum fields:

* `fileId → path` mapping
* `scope`, `collectedAt`
* `lastProcessedTimestamp` for polling cursor

**Sync API (Personal Server exposes internally):**

```
POST /v1/sync/trigger
  Force sync from storage backend
GET /v1/sync/status
  Get sync status (last sync, lastProcessedTimestamp, pending files, errors)
POST /v1/sync/file/{fileId}
  Sync specific file from storage backend
```

#### **4.1.8 Local Data Hierarchy**

Personal Servers store decrypted data in a standardized directory structure. This hierarchy is consistent across all implementation targets.

Directory paths are derived from scope segments (dot-separated). For example, `instagram.profile` maps to `~/.vana/data/instagram/profile/`.

```
~/.vana/                            # Root directory (all Personal Server targets)
├── data/                           # User data files (decrypted)
│   ├── instagram/
│   │   ├── profile/
│   │   │   ├── 2026-01-21T10-00-00Z.json    # versioned snapshot (UTC, filename-safe)
│   │   │   └── 2026-01-22T10-00-00Z.json
│   │   ├── posts/
│   │   │   ├── 2026-01-21T10-00-00Z.json
│   │   │   └── 2026-01-22T10-00-00Z.json
│   │   ├── likes/
│   │   │   ├── 2026-01-21T10-00-00Z.json
│   │   │   └── 2026-01-22T10-00-00Z.json
│   │   └── followers/
│   │       ├── 2026-01-21T10-00-00Z.json
│   │       └── 2026-01-22T10-00-00Z.json
│   ├── chatgpt/
│   │   └── conversations/
│   │       ├── 2026-01-21T10-00-00Z.json
│   │       └── 2026-01-22T10-00-00Z.json
│   ├── youtube/
│   │   ├── watch_history/
│   │   │   ├── 2026-01-21T10-00-00Z.json
│   │   │   └── 2026-01-22T10-00-00Z.json
│   │   └── subscriptions/
│   │       ├── 2026-01-21T10-00-00Z.json
│   │       └── 2026-01-22T10-00-00Z.json
│   └── gmail/
│       ├── messages/
│       │   ├── 2026-01-21T10-00-00Z.json
│       │   └── 2026-01-22T10-00-00Z.json
│       └── labels/
│           ├── 2026-01-21T10-00-00Z.json
│           └── 2026-01-22T10-00-00Z.json
│
├── logs/                           # Access logs (JSON lines, daily rotation)
│   └── access-{YYYY-MM-DD}.log   # Daily audit log
│
├── index.db                        # Local registry index (SQLite)
│
└── server.json                     # Server configuration (includes storage + OAuth + sync)
```

**Server Configuration (`~/.vana/server.json`):**

Single config file for the Personal Server, including storage backend selection, OAuth tokens, and sync state.

```json
{
  "version": "1.0",
  "server": {
    "address": "0x...",
    "url": "https://user-abc.server.vana.com",
    "capabilities": {
      "mcp": true,
      "compute": true
    }
  },
  "storage": {
    "backend": "vana", // vana | gdrive | dropbox | ipfs | local
    "config": {
      // backend-specific settings (e.g., bucket, base path, cid, etc.)
    },
    "oauth": {
      "gdrive": {
        "accessToken": "...",
        "refreshToken": "...",
        "expiresAt": "2026-01-21T10:00:00Z"
      },
      "dropbox": {
        "accessToken": "...",
        "refreshToken": "...",
        "expiresAt": "2026-01-21T10:00:00Z"
      }
    }
  },
  "sync": {
    "lastProcessedTimestamp": "2026-01-21T10:00:00Z"
  }
}
```

**File Naming Convention (Versioned):**

```
  ~/.vana/data/{scope}/{YYYY-MM-DDTHH-mm-ssZ}.json
Examples:
  ~/.vana/data/instagram/profile/2026-01-21T10-00-00Z.json
  ~/.vana/data/chatgpt/conversations/2026-01-21T10-00-00Z.json
  ~/.vana/data/youtube/watch_history/2026-01-21T10-00-00Z.json
```

**Data File Structure (decrypted, JSON only in v1):**

Each data file contains standardized metadata plus the actual data. Data files are immutable after write; `fileId` is tracked in the Personal Server local index, not written into the file.

```json
{
  "$schema": "https://ipfs.io/<cid_for_schema_id>", // must match schemaId registered on-chain (DataRefinerRegistry)
  "version": "1.0",
  "scope": "instagram.profile",
  "collectedAt": "2026-01-21T10:00:00Z",
  "data": {
    // Source-specific data structure
  }
}
```

#### **4.1.9 Builder Data Access Interface**

Personal Servers serve raw data to Builders for scopes explicitly granted by the user. Builders do not access storage backends directly; storage is used only for sync/portability. Compute/LLM operations are out of scope for this spec.

**Builder Read Request (HTTP):**

```
GET /data/{scope}
  Query params:
    ?fileId={fileId}        # specific version by DataRegistry fileId
    ?at={ISO8601}           # specific version by collectedAt (closest <= at)
    (default: latest by collectedAt)
  Headers:
    Authorization: Web3Signed <base64url(json)>.<signature>
```

**Signature Requirements:**

* Builder MUST include an `Authorization: Web3Signed ...` header per **4.1.9.1**.
* `grantId` in the Web3Signed payload MUST be the on-chain `permissionId` for the Builder and user.

**Grant Enforcement:**

* `grantId` (from Web3Signed payload) is the on-chain `permissionId` from `DataPortabilityPermissions`
* Personal Server recovers the signer address from the `Authorization` header and verifies it matches the on-chain grantee for `grantId`
* Requested `scope` MUST be a subset of the granted scopes
* Access is logged to the audit trail

**Response:**

* Returns the decrypted data file JSON for the requested `scope` (see **5.2 Data File Format** before encryption)
* If multiple versions exist, default is the most recent by `collectedAt`

#### **4.1.9.1 Web3Signed Authorization (Builder Requests)**

All builder-initiated Personal Server requests MUST include a signed authorization header:

```
Authorization: Web3Signed <base64url(json)>.<signature>
```

**Payload JSON (canonicalized, keys sorted alphabetically):**

```json
{
  "aud": "https://user-abc.server.vana.com",  // target origin
  "method": "GET",
  "uri": "/data?scopePrefix=instagram&limit=50&offset=0",
  "bodyHash": "",                            // empty string for GET
  "iat": 1737500000,
  "exp": 1737500300,
  "grantId": "0x..."                         // required only for raw data reads
}
```

**Signing Rules:**

* `json` MUST be canonicalized (keys sorted alphabetically at all levels).
* `base64url(json)` is the UTF-8 JSON string encoded with base64url (no padding).
* `signature` is an EIP-191 signature over the ASCII bytes of `<base64url(json)>`.

**Verification Rules (Personal Server):**

* Recover signer from `signature` and verify signer is a registered Builder on-chain.
* `aud` MUST match the Personal Server origin.
* `method` and `uri` MUST match the actual request.
* `bodyHash` MUST match the request body (empty string for GET).
* `iat`/`exp` MUST be within an allowed skew window (e.g., 5 minutes).
* For raw data reads (`GET /data/{scope}`), the Web3Signed payload MUST include `grantId`.

#### **4.1.10 MCP Server Integration**

The Personal Server includes an MCP (Model Context Protocol) server, enabling AI assistants to access user data with proper authorization.

**MCP Resources:**

| **URI** | **Description** |
| -- | -- |
| `vana://files` | List all data files for authenticated user |
| `vana://file/{scope}` | Get decrypted file content |
| `vana://file/{scope}/metadata` | Get file metadata only |
| `vana://grants` | List active grants |
| `vana://schemas` | List available data schemas |
| `vana://schema/{schemaId}` | Get schema definition |

**MCP Tools:**

```typescript
// List files with optional filtering
async function list_files(params: {
  wallet_address: string;
  scopePrefix?: string;
  limit?: number;
  offset?: number;
}): Promise<FileList>;
// Get file content with optional JSONPath filter
async function get_file(params: {
  wallet_address: string;
  scope: string;
  filter?: string;  // JSONPath expression
}): Promise<FileContent>;
// Search across files
async function search_files(params: {
  wallet_address: string;
  query: string;
  scopePrefixes?: string[];
}): Promise<SearchResults>;
```

**MCP Authentication:**

All MCP requests require EIP-191 wallet signature verification:

```typescript
// MCP client must sign request
const signature = await wallet.signMessage(JSON.stringify({
  action: "mcp_request",
  uri: "vana://files",
  timestamp: Date.now()
}));
// Personal Server verifies signature and checks grants
```

#### **4.1.11 Internet Accessibility (Tunneling)**

Desktop-Bundled Personal Servers need a mechanism to be accessible from the internet for builder requests. This is achieved through tunneling via a Vana-managed FRP (Fast Reverse Proxy) server.

**Vana FRP Tunnel**

FRP provides stable, long-lived URLs without requiring third-party accounts. Vana operates an FRP server at `proxy.server.vana.org` with wildcard DNS for `*.server.vana.org` and TLS termination via Let's Encrypt.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DESKTOP TUNNELING ARCHITECTURE                                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  User's Desktop                                                         ││
│  │  ┌─────────────────────────────────────────────────────────────────────┐││
│  │  │  Desktop App (Tauri)                                                │││
│  │  │  ├── Personal Server (localhost:8080)                               │││
│  │  │  └── frpc daemon                                                    │││
│  │  │       └── Outbound tunnel to Vana FRP server                        │││
│  │  └─────────────────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                 │                                           │
│                                 │ Outbound-only connection                  │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Vana FRP Server (proxy.server.vana.org)                               ││
│  │  URL: https://{userId}.server.vana.org                                 ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                 │                                           │
│                                 │ Builder request                           │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Builder App                                                            ││
│  │  GET https://{userId}.server.vana.org/data                             ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Why FRP over Cloudflare Tunnel:**

| Aspect | FRP | Cloudflare Tunnel |
| -- | -- | -- |
| Third-party account | Not required | Required |
| Subdomain control | Vana-managed, tied to on-chain userId | Random or requires CF account |
| Ingress quality | Vana controls | Cloudflare controls |

**Tunnel Lifecycle:**

| **Event** | **Action** |
| -- | -- |
| Desktop App opens | Start frpc, establish tunnel |
| Tunnel established | Register tunnel URL in DataPortabilityServers (if changed) |
| Desktop App closes | Tunnel terminates, builders get 503 |
| Builder request while offline | DP RPC returns "server unavailable" error |

**Fallback Behavior:**

When Desktop App is closed and user has NOT enabled ODL Cloud:

1. Builder requests to personal server URL fail (503 or timeout)
2. DP RPC returns `{ "error": "server_unavailable", "message": "User's personal server is offline" }`
3. Builder MAY prompt user: "Open your Vana app or enable always-on access"

When user HAS enabled ODL Cloud:

1. DataPortabilityServers points to Sprite URL (not tunnel URL)
2. Sprite auto-activates on request
3. Requests always succeed (with \~1-2s cold start latency)

### **4.2 Data Portability RPC (Gateway)**

#### **4.2.1 Purpose**

Provides fast API access to protocol operations with eventual chain consistency.

For now, all on-chain operations are submitted through the Gateway as a relayer; clients sign EIP-712 payloads and the Gateway validates the operations and returns immediately, without waiting for on-chain confirmation. Later, the Gateway broadcasts the operations on-chain asynchronously.

#### **4.2.2 Design Rationale**

Vana L1 is slow for real-time UX. The Gateway:

* Accepts signed operations immediately
* Returns instant responses
* Syncs to chain asynchronously
* Allows verification against chain for trust

#### **4.2.3 Trust Model**

Phase 0: Use Gateway + signature verification
Phase 1: Add on-chain anchoring, the operations can be verified on-chain after on-chain confirmation

```
┌─────────────────────────────────────────────────────────────────┐
│  TRUST SPECTRUM                                                 │
│                                                                 │
│  Fast ◀─────────────────────────────────────────────▶ Trustless │
│                                                                 │
│  Gateway      Gateway +         Gateway +        Chain          │
│  only         signature         spot-check       only           │
│               verification      chain                           │
│                                                                 │
│  ~50ms        ~50ms             ~50ms + async    ~5-10s         │
│  Trust Vana   Trust user        Trust but        Trustless      │
│               signed            verify                          │
└─────────────────────────────────────────────────────────────────┘
```

#### **4.2.4 Gateway API**

```
# Personal Server Operations
POST   /v1/servers/                Register/update Personal Server URL
GET    /v1/servers/{address}       Get Personal Server info
GET    /v1/servers/{address}/status 
                                   Get confirmation status (pending/confirmed)

# Grant Operations
POST   /v1/grants                  Create grant
DELETE /v1/grants/{grantId}        Revoke grant
GET    /v1/grants/{grantId}        Get grant details
GET    /v1/grants?user={address}   List grants for user
GET    /v1/grants?builder={address} 
                                   List grants for builder
GET    /v1/grants/{grantId}/status Get confirmation status (pending/confirmed)

# File Registry Operations
POST   /v1/files                   Register file record (schemaId required)
GET    /v1/files/{fileId}          Get file record
GET    /v1/files?user={address}    List files for user
GET    /v1/files?user={address}&since={ISO8601}    
                                   List files for user since timestamp
GET    /v1/files/{fileId}/status 
                                   Get confirmation status (pending/confirmed)

# Schema Registry
GET    /v1/schemas/{schemaId}      Get schema metadata (canonical scope + schema URL)
GET    /v1/schemas?scope={scope}   Look up schemaId by canonical scope (reverse lookup)
GET    /v1/schemas/{schemaId}/status 
                                   Get confirmation status (pending/confirmed)

# Builder Operations
POST   /v1/builders/register       Register builder (public key + app URL)
GET    /v1/builders/{address}      Get builder info (public key + app URL)
GET    /v1/builders/{address}/status 
                                   Get confirmation status (pending/confirmed)


# Sync Status
GET    /v1/sync/status             Get chain sync status

# Nonces
GET    /v1/nonces?user={address}&operation={operation}
                                   Get the current and next nonce per user and operation
```

`grantId` refers to the on-chain `permissionId` from `DataPortabilityPermissions`.

`serverAddress` and `builderAddress` are used as their idempotent IDs. `grantId` and `fileId` are computed deterministically from their input parameters. Those IDs are consistent between the off-chain gateway and the on-chain smart contracts, so that they can be used to query both on-chain and off-chain with the Gateway. 

#### **4.2.5 Gateway Response Format**

All responses include verification data:

```json
{
  "data": {
    "serverUrl": "https://server.alice.com",
    "publicKey": "0x..."
  },
  "proof": {
    "userSignature": "0x...",       // User's EIP-712 signature
    "gatewaySignature": "0x...",    // Gateway attestation
    "timestamp": 1737500000,
    "status": "pending",            // Chain sync status, pending or confirmed
    "estimatedConfirmation": "30s", // Estimated on-chain confirmation timechainConfirmed": true,       // Has been synced to chain
    "chainBlockHeight": null        // Block where confirmed
  }
}
```

### **4.3 Vana L1 (On-Chain Contracts)**

#### **4.3.1 Contract: DataPortabilityServers**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract DataPortabilityServers {
    struct ServerInfo {
        uint256 id;
        address owner;
        address serverAddress;
        string publicKey;
        string url;
    }
    struct TrustedServerInfo {
        uint256 id;
        address owner;
        address serverAddress;
        string publicKey;
        string url;
        uint256 startBlock;
        uint256 endBlock;
    }
    struct AddServerInput {
        address serverAddress;
        string publicKey;
        string serverUrl;
    }
    struct AddServerWithSignatureInput {
        uint256 nonce;
        address serverAddress;
        string publicKey;
        string serverUrl;
    }
    struct TrustServerInput {
        uint256 nonce;
        uint256 serverId;
    }
    struct UntrustServerInput {
        uint256 nonce;
        uint256 serverId;
    }
    event ServerRegistered(uint256 indexed serverId, address indexed owner, address indexed serverAddress, string publicKey, string url);
    event ServerUpdated(uint256 indexed serverId, string url);
    event ServerTrusted(address indexed user, uint256 indexed serverId);
    event ServerUntrusted(address indexed user, uint256 indexed serverId);
    function addServerWithSignature(AddServerWithSignatureInput input, bytes signature) external;
    function addAndTrustServerWithSignature(AddServerWithSignatureInput input, bytes signature) external;
    function addAndTrustServerByManager(address ownerAddress, AddServerInput input) external;
    function updateServer(uint256 serverId, string memory url) external;
    function trustServer(uint256 serverId) external;
    function trustServerWithSignature(TrustServerInput input, bytes signature) external;
    function trustServerByManager(address userAddress, uint256 serverId) external;
    function untrustServer(uint256 serverId) external;
    function untrustServerWithSignature(UntrustServerInput input, bytes signature) external;
    function servers(uint256 serverId) external view returns (ServerInfo memory);
    function serverByAddress(address serverAddress) external view returns (ServerInfo memory);
    function userServerValues(address userAddress) external view returns (TrustedServerInfo[] memory);
    function userServers(address userAddress, uint256 serverId) external view returns (TrustedServerInfo memory);
    function userNonce(address user) external view returns (uint256);
}
```

#### **4.3.2 Contract: DataPortabilityGrantees**

```solidity
contract DataPortabilityGrantees {
    struct GranteeInfo {
        address owner;
        address granteeAddress;
        string publicKey;
        string appUrl; // New field
        uint256[] permissionIds;
    }
    struct GranteeInfoV2 {
        address owner;
        address granteeAddress;
        string publicKey;
        string appUrl; // New field
        uint256 permissionsCount;
    }
    event GranteeRegistered(
        uint256 indexed granteeId,
        address indexed owner,
        address indexed granteeAddress,
        string publicKey,
        string appUrl
    );
    function registerGrantee(
        address owner,
        address granteeAddress,
        string memory publicKey,
        string memory appUrl
    ) external returns (uint256);
    function grantees(uint256 granteeId) external view returns (GranteeInfo memory);
    function granteesV2(uint256 granteeId) external view returns (GranteeInfoV2 memory);
    function granteeByAddress(address granteeAddress) external view returns (GranteeInfo memory);
    function granteeByAddressV2(address granteeAddress) external view returns (GranteeInfoV2 memory);
    function granteeAddressToId(address granteeAddress) external view returns (uint256);
    function granteesCount() external view returns (uint256);
    function granteePermissions(uint256 granteeId) external view returns (uint256[] memory);
}
```

#### **4.3.3 Contract: DataPortabilityPermissions**

```solidity
contract DataPortabilityPermissions {
    struct PermissionInfo {
        uint256 id;
        address grantor;
        uint256 nonce;
        uint256 granteeId;
        string grant;
        uint256 startBlock;
        uint256 endBlock;
        uint256[] fileIds;
    }
    struct PermissionInput {
        uint256 nonce;
        uint256 granteeId;
        string grant;
        uint256[] fileIds;
    }
    struct ServerFilesAndPermissionInput {
        uint256 nonce;
        uint256 granteeId;
        string grant;
        string[] fileUrls;
        uint256[] schemaIds;
        address serverAddress;
        string serverUrl;
        string serverPublicKey;
        IDataRegistry.Permission[][] filePermissions;
    }
    struct RevokePermissionInput {
        uint256 nonce;
        uint256 permissionId;
    }
    event PermissionAdded(uint256 indexed permissionId, address indexed user, uint256 indexed granteeId, string grant, uint256[] fileIds);
    event PermissionRevoked(uint256 indexed permissionId);
    function addPermission(PermissionInput calldata permission, bytes calldata signature) external returns (uint256);
    function addServerFilesAndPermissions(ServerFilesAndPermissionInput calldata input, bytes calldata signature) external returns (uint256);
    function revokePermission(uint256 permissionId) external;
    function revokePermissionWithSignature(RevokePermissionInput calldata input, bytes calldata signature) external;
    function permissions(uint256 permissionId) external view returns (PermissionInfo memory);
    function permissionFileIds(uint256 permissionId) external view returns (uint256[] memory);
    function filePermissionIds(uint256 fileId) external view returns (uint256[] memory);
    function permissionsCount() external view returns (uint256);
    function userNonce(address user) external view returns (uint256);
    function userPermissionIdsValues(address user) external view returns (uint256[] memory);
    function dataRegistry() external view returns (IDataRegistry);
    function dataPortabilityServers() external view returns (IDataPortabilityServers);
    function dataPortabilityGrantees() external view returns (IDataPortabilityGrantees);
}
```

#### **4.3.4 Contract: DataRegistry**

```solidity
contract DataRegistry {
    struct FileResponse {
        uint256 id;
        address ownerAddress;
        string url;
        uint256 schemaId;
        uint256 addedAtBlock;
    }
    struct Permission {
        address account;
        string key;
    }
    event FileAdded(uint256 indexed fileId, address indexed ownerAddress, string url);
    event FileAddedV2(uint256 indexed fileId, address indexed ownerAddress, string url, uint256 schemaId);
    event PermissionGranted(uint256 indexed fileId, address indexed account);
    function addFile(string memory url) external returns (uint256);
    function addFileWithSchema(string memory url, uint256 schemaId) external returns (uint256);
    function addFileWithPermissions(string memory url, address ownerAddress, Permission[] memory permissions) external returns (uint256);
    function addFileWithPermissionsAndSchema(string memory url, address ownerAddress, Permission[] memory permissions, uint256 schemaId) external returns (uint256);
    function addFilePermissionsAndSchema(uint256 fileId, Permission[] memory permissions, uint256 schemaId) external;
    function addFilePermission(uint256 fileId, address account, string memory key) external;
    function files(uint256 index) external view returns (FileResponse memory);
    function fileIdByUrl(string memory url) external view returns (uint256);
    function filePermissions(uint256 fileId, address account) external view returns (string memory);
}
```

**Requirement:** Clients MUST register files with a `schemaId` (use `addFileWithSchema` or `addFileWithPermissionsAndSchema`). Calls that omit `schemaId` are invalid for Data Portability Protocol compliance.

### **4.4 Data Portability Client (Desktop App)**

#### **4.4.1 Purpose**

A user-facing application that:

1. Authenticates user to the protocol
2. Runs Data Connectors to collect data
3. Configures Personal Server
4. Manages grants and permissions
5. Provides data browsing and search

#### **4.4.2 Key Distinction**

The Desktop App is a **protocol client**, NOT a **protocol participant**:

* It is NOT registered on-chain
* It CONTROLS the Personal Server (which IS a protocol participant)
* If it bundles a Personal Server, that server still MUST be registered on-chain and is the participant
* Multiple Desktop Apps can exist (different platforms, different UIs)

#### **4.4.3 Roles**

```
┌─────────────────────────────────────────────────────────────────┐
│  DATA PORTABILITY CLIENT ROLES                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  IDENTITY                                                       │
│    ├── Sign in via Passport (wallet abstraction)                │
│    └── Manage wallet settings (in Passport)                     │
│                                                                 │
│  DATA COLLECTION (Not part of protocol)                         │
│    ├── Run Data Connectors (scraping)                           │
│    ├── Send raw data to Personal Server (local or remote)        │
│    └── Personal Server encrypts + uploads to storage backend     │
│                                                                 │
│  PERSONAL SERVER CONFIGURATION                                  │
│    ├── Register Personal Server on-chain (address + URL)        │
│    ├── Configure storage backend (enables sync + on-chain writes)│
│    ├── Configure capabilities                                   │
│    └── Monitor server health                                    │
│                                                                 │
│  PERMISSION MANAGEMENT                                          │
│    ├── View incoming grant requests                             │
│    ├── Approve/deny grants                                      │
│    ├── Revoke existing grants                                   │
│    └── Set auto-approve rules                                   │
│                                                                 │
│  DATA MANAGEMENT                                                │
│    ├── Browse connected data                                    │
│    ├── View access logs                                         │
│    ├── Delete data                                              │
│    └── Export data                                              │
│                                                                 │
│  TOOLING (Not part of protocol, bundled for convenience)        │
│    ├── Local search / vector DB                                 │
│    ├── MCP server for local AI                                  │
│    └── Data visualization                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### **4.4.4 Local Data Flow**

```
┌─────────────────────────────────────────────────────────────────┐
│  DATA PORTABILITY CLIENT                                        │
│                                                                 │
│  ┌─────────────────┐                                            │
│  │ Data Connector  │──── Scrape data ────▶ Platform             │
│  │ (e.g. Instagram)│                       (Instagram)          │
│  └────────┬────────┘                                            │
│           │ Raw data (JSON)                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                            │
│  │ Personal Server │                                            │
│  │ (bundled or     │                                            │
│  │  remote)        │                                            │
│  └────────┬────────┘                                            │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                            │
│  │ Local Storage   │  ~/.vana/data/{scope}/... (unencrypted)      │
│  └────────┬────────┘                                            │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                            │
│  │ Encrypt + Upload│──────▶ Storage Backend (if configured)      │
│  └─────────────────┘                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Until a storage backend is selected, sync targets the local Personal Server only and does not write to the on-chain registry.

#### **4.4.5 Passport (Client-side, Non-Protocol Component)**

##### **4.4.5.1 Purpose**

Client-side authentication and wallet provisioning. Passport is NOT part of the protocol; each client can choose its own vendor to manage user wallets and map them to on-chain addresses.

##### **4.4.5.2 Requirements**

* MUST support wallet creation without seed phrase exposure to user
* MUST support social login (Google, Apple, email)
* MUST support wallet recovery via social/email
* SHOULD support existing wallet import for advanced users

##### **4.4.5.3 Reference Implementation**

Vana uses Privy as the Passport vendor in the Desktop App; other clients may use different providers.

##### **4.4.5.4 Authentication Flow**

```
┌─────────┐          ┌─────────────┐          ┌─────────┐
│  User   │          │  Passport   │          │  Client │
│         │          │  (Vendor)   │          │         │
└────┬────┘          └──────┬──────┘          └────┬────┘
     │                      │                      │
     │  1. Click "Sign In"  │                      │
     │────────────────────────────────────────────▶│
     │                      │                      │
     │  2. Redirect to Passport │                  │
     │◀────────────────────────────────────────────│
     │                      │                      │
     │  3. Authenticate     │                      │
     │─────────────────────▶│                      │
     │                      │                      │
     │  4. Create/retrieve  │                      │
     │     wallet           │                      │
     │◀─────────────────────│                      │
     │                      │                      │
     │  5. Return JWT +     │                      │
     │     wallet address   │                      │
     │◀────────────────────────────────────────────│
     │                      │                      │
```

### **4.5 Session Relay Service**

The Session Relay is a standalone service that coordinates "Connect Data" between the builder web popup and the Desktop App. It stores short-lived session state in a Neon PostgreSQL database and is not part of the DP RPC/Gateway.

**Session State**

`pending` → `claimed` → `approved` → `completed` → `expired` (15 minutes)

**Request Signing**

* `POST /v1/session/init` MUST include `Authorization: Web3Signed <base64url(json)>.<signature>`
* The Web3Signed payload uses the same format as **4.1.9.1**, with:
  * `aud` = Session Relay origin
  * `uri` = `/v1/session/init`
  * `bodyHash` = SHA-256 of the request body
* `app_user_id` is optional and used only for builder correlation when the grant is returned
* Session Relay verifies the signature against `granteeAddress`

**Session API**

```
POST /v1/session/init
  Headers: { Authorization: Web3Signed <base64url(json)>.<signature> }
  Input: { granteeAddress, scopes, webhookUrl?, app_user_id? }
  Output: { sessionId, deepLinkUrl, expiresAt }
GET /v1/session/{sessionId}/poll
  Input: { }
  Output: { status, grant? }
POST /v1/session/claim
  Input: { sessionId }
  Output: { sessionId, granteeAddress, scopes, webhookUrl?, app_user_id?, expiresAt }
POST /v1/session/{sessionId}/approve
  Input: { signedGrant }
  Output: { status: "success" }
```

**Grant Payload (returned via poll/webhook):**

```json
{
  "grantId": "0x...",          // on-chain permissionId
  "userAddress": "0x...",
  "builderAddress": "0x...",
  "scopes": ["instagram.profile", "instagram.likes"],
  "expiresAt": 0,
  "app_user_id": "optional"
}
```

Builders use `grantId` to fetch full grant details from the Gateway and `userAddress` to resolve the Personal Server URL.

---

## **5. Data Formats**

### **5.1 Scope Taxonomy**

Scopes follow a hierarchical naming convention:

```
{source}.{category}[.{subcategory}]
Examples:
  instagram.profile
  instagram.posts
  instagram.likes
  instagram.followers
  chatgpt.conversations
  chatgpt.conversations.shared
  youtube.watch_history
  youtube.subscriptions
  gmail.messages
  gmail.labels
```

The `source` is derived from the first segment of the scope (e.g., `instagram` in `instagram.posts`).

Schema definitions MUST encode the canonical `scope` for the dataset (e.g., in schema metadata). This provides the pre-decryption reference needed to derive scope keys from `schemaId`; the file payload remains the source of truth for `scope` and `collectedAt`.

### **5.2 Data File Format**

In v1, data files are JSON objects before encryption (future versions may support other mime types). The entire plaintext JSON object is encrypted as a single blob; no plaintext metadata is stored alongside the ciphertext. `fileId` linkage is tracked in the Personal Server local index, not written into the file. Each data file MUST include a `$schema` URL that points to the IPFS CID for the `schemaId` registered on-chain (DataRefinerRegistry).

```
{
  "version": "1.0",
  "scope": "instagram.profile",
  "collectedAt": "2026-01-21T10:00:00Z",
  "data": {
    "username": "alice",
    "displayName": "Alice Smith",
    "bio": "...",
    "followers": 1234,
    "following": 567
  }
}
```

After encryption, the file is stored as raw ciphertext bytes.

### **5.3 Grant Format (EIP-712)**

```typescript
const grantTypedData = {
  domain: {
    name: "Vana Data Portability",
    version: "1",
    chainId: 14800,
    verifyingContract: "0x..." // DataPortabilityPermissions address
  },
  types: {
    Grant: [
      { name: "user", type: "address" },
      { name: "builder", type: "address" },
      { name: "scopes", type: "string[]" },
      { name: "expiresAt", type: "uint256" },
      { name: "nonce", type: "uint256" }
    ]
  },
  primaryType: "Grant",
  message: {
    user: "0x...",
    builder: "0x...",
    scopes: ["instagram.profile", "instagram.likes"],
    expiresAt: 0,
    nonce: 1
  }
};
```

**Grant Identifier:**

* `grantId` in API responses refers to the on-chain `permissionId` returned by `DataPortabilityPermissions`.

### **5.4 Access Log Format**

```json
{
  "logId": "uuid",
  "grantId": "0x...",
  "builder": "0x...",
  "action": "read",
  "scope": "instagram.profile",
  "timestamp": "2026-01-21T10:00:00Z",
  "ipAddress": "1.2.3.4",
  "userAgent": "BuilderSDK/1.0"
}
```

### **5.5 Builder App Metadata (Web App Manifest + `vana` Block)**

Builders MUST publish an app manifest to provide human-readable consent UI metadata. The Builder's `appUrl` is stored on-chain (DataPortabilityGrantees) and is the canonical origin for discovering the manifest.

**Manifest Discovery (Browser-Compatible):**

* Clients MUST fetch `https://{appUrl}` and resolve the manifest URL from `<link rel="manifest" href="...">`
* The manifest URL MUST be same-origin with `appUrl`

**Base Standard:** W3C Web App Manifest with a custom top-level `vana` block for protocol-specific metadata.

**Required `vana` Fields (logical):**

* `vana.appUrl` (canonical app origin, must match on-chain `appUrl`)
* `vana.privacyPolicyUrl`
* `vana.termsUrl`
* `vana.supportUrl`
* `vana.webhookUrl`
* `vana.signature` (Builder signature over the `vana` block)

**Scope Labels:**

* Consent UI labels for scopes come from Data Connector metadata in the Desktop App, not from the manifest.

**Signature:**

* `vana.signature` MUST be an EIP-191 signature by the Builder address over the canonical JSON of the `vana` block
* Canonicalization: sort keys alphabetically, and exclude the `signature` field from the signed payload

**Verification (Desktop App / Personal Server UI):**

1. Fetch `https://{appUrl}` and resolve the manifest URL from `<link rel="manifest">`
2. Verify `vana.appUrl` equals the on-chain `appUrl`
3. Recompute the canonical JSON for the `vana` block and verify `vana.signature` recovers the Builder address
4. Ensure requested `webhookUrl` matches `vana.webhookUrl`

**Manifest Failure:**

* If manifest discovery or signature verification fails, the Desktop App MUST NOT render the consent screen and MUST fail the session flow.

**Example Manifest (abridged):**

```json
{
  "name": "Flipboard",
  "short_name": "Flipboard",
  "start_url": "https://flipboard.com/",
  "scope": "https://flipboard.com/",
  "icons": [{ "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" }],
  "vana": {
    "appUrl": "https://flipboard.com",
    "privacyPolicyUrl": "https://flipboard.com/privacy",
    "termsUrl": "https://flipboard.com/terms",
    "supportUrl": "https://flipboard.com/support",
    "webhookUrl": "https://api.flipboard.com/vana/webhook",
    "signature": "0x..."
  }
}
```

---

### **5.6 Data Connector Spec**

Data Connectors define the canonical human-readable names for scopes. The Desktop App MUST use Data Connector metadata to render consent UI labels.

**Connector Definition (logical):**

```json
{
  "connectorId": "instagram",
  "displayName": "Instagram",
  "scopes": [
    {
      "scope": "instagram.profile",
      "label": "Your Instagram profile",
      "description": "Basic profile info, bio, and counts"
    },
    {
      "scope": "instagram.posts",
      "label": "Your Instagram posts",
      "description": "Your posts and captions"
    }
  ],
  "version": "1.0"
}
```

---

## **6. Protocol Operations**

### **6.1 User Registration Flow**

```
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│  User   │      │ Desktop │      │ Identity│      │ DP RPC  │
│         │      │   App   │      │Provider │      │         │
└────┬────┘      └────┬────┘      └────┬────┘      └────┬────┘
     │                │                │                │
     │ 1. Open app    │                │                │
     │───────────────▶│                │                │
     │                │                │                │
     │                │ 2. Redirect    │                │
     │                │───────────────▶│                │
     │                │                │                │
     │ 3. Authenticate (social/email)  │                │
     │────────────────────────────────▶│                │
     │                │                │                │
     │                │ 4. Wallet      │                │
     │                │    created     │                │
     │                │◀───────────────│                │
     │                │                │                │
     │                │                │                │
     │ 7. Setup complete               │                │
     │◀───────────────│                │                │
     │                │                │                │
```

### **6.2 Data Connection Flow**

```
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌────────────┐      ┌─────────┐      ┌─────────┐
│  User   │      │ Desktop │      │ Platform│      │ Personal   │      │ Storage │      │ DP RPC  │
│         │      │   App   │      │(Instagram)     │  Server    │      │ Backend │      │(Gateway)│
└────┬────┘      └────┬────┘      └────┬────┘      └────┬───────┘      └────┬────┘      └────┬────┘
     │                │                │                │                │                │
     │ 1. Click       │                │                │                │                │
     │ "Connect       │                │                │                │                │
     │  Instagram"    │                │                │                │                │
     │───────────────▶│                │                │                │                │
     │                │                │                │                │                │
     │                │ 2. Open embedded browser        │                │                │
     │                │───────────────▶│                │                │                │
     │                │                │                │                │                │
     │ 3. Log in to Instagram          │                │                │                │
     │────────────────────────────────▶│                │                │                │
     │                │                │                │                │                │
     │                │ 4. Scrape data │                │                │                │
     │                │   (user's IP)  │                │                │                │
     │                │◀───────────────│                │                │                │
     │                │                │                │                │                │
     │                │ 5. Send raw data               │                │                │
     │                │───────────────────────────────▶│                │                │
     │                │                │                │                │                │
     │                │                │                │ 6. Store locally (unencrypted) │
     │                │                │                │                │                │
     │                │                │                │ 7. Upload encrypted blob        │
     │                │                │                │───────────────────────────────▶│
     │                │                │                │                │                │
     │                │                │                │ 8. Register file record         │
     │                │                │                │────────────────────────────────▶│
     │                │                │                │                │                │
     │ 9. "Instagram connected ✓"      │                │                │                │
     │◀───────────────│                │                │                │                │
     │                │                │                │                │                │
```

If no storage backend has been selected yet, steps 7–8 are skipped; data remains local-only and is not written on-chain.

### **6.3 "Connect Data" Flow**

The "Connect data" flow allows users to connect their Vana Personal Server to a third-party Builder application. This flow uses a standalone **Session Relay** service to coordinate between the builder web popup and the Desktop App using deep links (no manual code entry).

#### **6.3.1 Flow Overview**

1. **Initiation**: User clicks "Connect data" on Builder App.
2. **Session Creation**: Builder backend creates a session (signed) via Session Relay. The frontend opens a popup with a deep link.
3. **Desktop Pairing**: User opens the Desktop App via deep link (Desktop App must be installed).
4. **Consent**: Desktop App fetches session details, resolves Builder metadata by discovering the manifest from `appUrl`, verifies signature, and prompts the user to approve.
5. **Completion**: Desktop App submits the signed Grant to the Gateway (relayer) to create the on-chain `permissionId`, then submits the signed Grant + `permissionId` to the Session Relay. The Builder receives the grant payload via polling or webhook and completes the login.

Grant payload includes `grantId` (on-chain `permissionId`) and the user's wallet address.

#### **6.3.2 Sequence Diagram**

```
┌─────────┐      ┌─────────┐      ┌────────────┐      ┌─────────┐
│  User   │      │ Builder │      │  Session   │      │ Desktop │
│         │      │ (Browser│      │   Relay    │      │ App     │
│         │      │ Popup)  │      │ (Service)  │      │         │
└────┬────┘      └────┬────┘      └────┬───────┘      └────┬────┘
     │                │                │                │
     │ 1. Click "Connect │                │                │
     │    data"       │                │                │
     │───────────────▶│                │                │
     │                │                │                │
     │                │ 2. Open Popup                   │
     │                │    (sessionId)                  │
     │                │───────────────▶│                │
     │                │                │                │
     │                │                │ 3. Session already created
     │                │                │    Return session_id
     │                │                │────────────────│
     │                │                │                │
     │                │                │ 4. Display Deep Link
     │                │                │◀───────────────│
     │                │                │                │
     │ 5. Install     │                │                │
     │    Desktop App │                │                │
     │───────────────▶│                │                │
     │                │                │                │
     │ 6. Open App,   │                │                │
     │    Sign In,    │                │                │
     │    Open Deep   │                │                │
     │    Link        │                │                │
     │─────────────────────────────────────────────────▶│
     │                │                │                │
     │                │                │ 7. Claim Session (Deep Link)
     │                │                │◀───────────────│
     │                │                │                │
     │                │                │ 8. Return Session Details
     │                │                │    (Builder address, Scopes)
     │                │                │───────────────▶│
     │                │                │                │
     │ 9. Approve     │                │                │
     │    Grant       │                │                │
     │─────────────────────────────────────────────────▶│
     │                │                │                │
     │                │                │ 10. Submit Signed Grant
     │                │                │◀───────────────│
     │                │                │                │
     │                │ 11. Poll/webhook for Grant      │
     │                │◀───────────────│                │
     │                │                │                │
     │                │ 12. Fetch Data (using Grant)    │
     │                │────────────────────────────────▶│
     │                │                                 │
```

### **6.4 Grant Revocation Flow**

```
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│  User   │      │ Desktop │      │ Gateway │      │Personal │
│         │      │   App   │      │         │      │ Server  │
└────┬────┘      └────┬────┘      └────┬────┘      └────┬────┘
     │                │                │                │
     │ 1. Click       │                │                │
     │ "Revoke" for   │                │                │
     │ Builder X      │                │                │
     │───────────────▶│                │                │
     │                │                │                │
     │                │ 2. Sign revocation              │
     │                │────────────────│                │
     │                │                │                │
     │                │ 3. Submit to Gateway            │
     │                │───────────────▶│                │
     │                │                │                │
     │                │ 4. Instant "Revoked"            │
     │                │◀───────────────│                │
     │                │                │                │
     │                │                │ 5. Async: record on-chain
     │                │                │────────────────▶
     │                │                │                │
     │                │ 6. Notify Personal Server       │
     │                │───────────────────────────────▶│
     │                │                │                │
     │                │                │                │ 7. Block
     │                │                │                │    future
     │                │                │                │    requests
     │                │                │                │
     │ 8. "Grant      │                │                │
     │    revoked ✓"  │                │                │
     │◀───────────────│                │                │
     │                │                │                │
```

### **6.5 Data Deletion Flow**

**Principle:** DataRegistry file entries are immutable; deletion is implemented as storage cleanup plus permission revocation and a tombstone that signals the file is no longer available.

```
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐
│  User   │      │ Desktop │      │Personal │      │ Storage │      │ Gateway │
│         │      │   App   │      │ Server  │      │ Backend │      │         │
└────┬────┘      └────┬────┘      └────┬────┘      └────┬────┘      └────┬────┘
     │                │                │                │                │
     │ 1. Click       │                │                │                │
     │ "Delete data"  │                │                │                │
     │───────────────▶│                │                │                │
     │                │ 2. Request delete               │                │
     │                │───────────────────────────────▶│                │
     │                │                │                │                │
     │                │                │ 3. Delete encrypted blob        │
     │                │                │───────────────────────────────▶│
     │                │                │                │                │
     │                │                │ 4. Remove local decrypted copy  │
     │                │                │                │                │
     │                │ 5. Write tombstone / registry update            │
     │                │────────────────────────────────────────────────▶│
     │                │                │                │                │
     │ 6. "Deleted ✓" │                │                │                │
     │◀───────────────│                │                │                │
```

**Notes:**

* Deletion is user-initiated (Desktop App or Personal Server UI) and is not exposed to builders.
* Gateway or chain layer records a delete marker (tombstone) so downstream systems treat the file as unavailable.
* Personal Servers MUST treat tombstoned file records as non-existent and return `410` or `404` for read attempts.

### **6.6 Builder React Package (@vana/connect)**

The builder-facing React package provides the default "Connect data" UX and abstracts Session Relay complexity. It is React-only and compatible with any React framework (e.g., Next.js).

**Prerequisite:** The Builder must be registered on-chain (via the Desktop App + Gateway relayer) with a valid `appUrl` and public key.

**Builder Registration (Desktop App) — Minimal Steps**

1. Open Desktop App -> **Builder Registration**
2. Enter `appUrl` (canonical app origin)
3. Desktop App generates (or imports) a Builder wallet and keypair
4. Desktop App displays:
   * Builder address (granteeAddress)
   * Builder public key
   * Builder private key (download/store securely)
5. Desktop App submits `registerGrantee` via Gateway relayer
6. Builder config:
   * Set `VANA_APP_PRIVATE_KEY` in server env (used to sign `Authorization: Web3Signed ...`)
   * Use `granteeAddress` in `@vana/connect` init
   * Publish manifest at `appUrl` with valid `vana` block

**Responsibilities**

* Create a Session Relay session and render the popup/modal
* Display deep link to the Desktop App (no manual code entry)
* Resolve completion via polling and/or webhook
* Return the signed Grant payload to the builder application
* Enforce that the Builder has an on-chain `appUrl` and a valid manifest discoverable via `<link rel="manifest">`

**Required Inputs (Logical)**

* Builder identifier (`granteeAddress`)
* Builder authorization for the session init request (must be created server-side and sent as `Authorization: Web3Signed ...`)
* Requested scopes
* Optional webhook URL
* Optional `app_user_id` for builder-local user tracking

**Surface Area (Minimal)**

* A single high-level `connect(...)` entrypoint that returns the grant payload (session must be created server-side)
* A default modal component for fast integration
* Hooks for custom UI using the same session lifecycle

**Signing Helpers**

`@vana/connect` SHOULD provide helpers to canonicalize JSON (sort keys alphabetically) and generate `Authorization: Web3Signed ...` when a builder wallet signer is provided.

---

## **7. Security Considerations**

### **7.1 Encryption**

#### **7.1.1 Data Encryption**

* All user data MUST be encrypted with AES-256-GCM before being written to a storage backend
* Personal Servers serve decrypted data to authorized builders over TLS
* Vana (or any intermediary) MUST NOT have access to plaintext data

### **7.2 Authentication**

* On-chain protocol operations MUST be signed by the user's wallet using EIP-712 typed data.
* Personal Server data requests from Builders MUST include `Authorization: Web3Signed ...` using ECDSA (EIP-191) per **4.1.9.1**.
* Nonces MUST be used to prevent replay attacks for on-chain operations.

### **7.3 Authorization**

* Personal Server MUST verify grant validity before serving data.
* Grant verification MUST check:
  * Signature is valid
  * Grant is not revoked
  * Grant has not expired
  * Requested scope is within granted scopes
  * `Authorization` signer matches the on-chain grantee for the grant

### **7.4 Transport Security**

* All HTTP endpoints MUST use TLS 1.3
* Personal Servers SHOULD implement certificate pinning
* Gateway SHOULD implement rate limiting

### **7.5 Threat Model**

| **Threat** | **Mitigation** |
| -- | -- |
| Vana sees user data | Data encrypted before upload, Vana has no key |
| Builder exceeds granted scope | Personal Server validates scope on each request |
| Grant replay | Nonces and timestamps in grant signature |
| Malicious builder | User must explicitly approve, can revoke anytime |
| Gateway lies about grants | Grants include user signature, verifiable on chain |
| Personal Server compromised | User data on that server may be exposed; storage backend remains encrypted |

---

## **8. Error Handling**

### **8.1 Error Code Structure**

Following SMTP convention, DP uses a 3-digit error code system:

```
First digit:
  2xx - Success
  3xx - Intermediate (more input needed)
  4xx - Temporary failure (retry may succeed)
  5xx - Permanent failure (do not retry)
Second digit:
  x0x - Syntax/format
  x1x - Authentication/authorization
  x2x - Data/storage
  x3x - Grant/permission
  x4x - Protocol/network
  x5x - Rate limiting
```

### **8.2 Error Codes**

| **Code** | **Description** |
| -- | -- |
| 200 | Success |
| 201 | Created |
| 301 | Redirect to personal server |
| 400 | Bad request (syntax error) |
| 401 | Unauthorized (invalid signature) |
| 403 | Forbidden (valid auth but not permitted) |
| 404 | Not found |
| 410 | Grant revoked |
| 411 | Grant expired |
| 412 | Scope not granted |
| 420 | Data not found at registry entry |
| 421 | Storage backend unavailable |
| 429 | Rate limited |
| 440 | Chain sync pending |
| 500 | Internal server error |
| 503 | Service unavailable |

### **8.3 Error Response Format**

```json
{
  "error": {
    "code": 412,
    "message": "Scope not granted",
    "details": {
      "requestedScope": "instagram.messages",
      "grantedScopes": ["instagram.profile", "instagram.likes"]
    }
  }
}
```

---

## **9. Extensibility**

### **9.1 Adding New Data Sources**

New data sources can be added by:

1. Creating a Data Connector (implementation-specific, not protocol)
2. Defining scope taxonomy for the dataset
3. Implementing data format schema

Data Connectors are NOT part of the protocol. They are implementation details of specific clients.

### **9.2 Adding New Storage Backends**

Storage backends implement a standard interface:

```typescript
interface StorageBackend {
  write(path: string, data: Buffer): Promise<string>;  // Returns location
  read(location: string): Promise<Buffer>;
  delete(location: string): Promise<void>;
  exists(location: string): Promise<boolean>;
}
```

### **9.3 Adding New Capabilities**

Personal Servers declare capabilities in their registration:

```
capabilities: ["storage", "compute", "mcp"]
```

New capabilities can be defined without protocol changes.

---

## **Appendix A: Alignment Analysis**

### **A.1 Discussion Points Reviewed**

Based on team discussions, the following clarifications resolve potential misalignments:

#### **A.1.1 Desktop App vs Personal Server**

| **Aspect** | **Desktop App** | **Personal Server** |
| -- | -- | -- |
| Protocol participant? | NO | YES |
| Registered on-chain? | NO | YES |
| Can receive requests? | NO | YES |
| Can act unattended? | NO | YES |
| Multiple instances? | YES (per user) | YES (per user) |
| Relationship | Controls | Is controlled |

**Resolution:** Desktop App is a CLIENT that CONFIGURES the Personal Server. Like how an email client configures SMTP/IMAP servers. If the Desktop App bundles a Personal Server, the embedded server is still the protocol participant and must be registered on-chain; the app remains a client.

#### **A.1.2 Data Connectors**

Data Connectors (web scrapers) are NOT part of the protocol. They are:

* Implementation-specific to the Desktop App
* Can vary between clients
* Follow protocol standard for data output format

**Resolution:** The protocol defines data FORMAT, not data COLLECTION.

#### **A.1.3 Bundled Tooling**

Search, vector DB, MCP server are NOT part of the protocol. They are:

* Convenience features bundled with Desktop App
* Can be omitted in alternative clients
* Advanced queries belong in third-party apps (like Vana Trace)

**Resolution:** Protocol is minimal. Desktop App bundles extras for UX.

#### **A.1.4 Encryption Requirements (Resolved)**

**Discussion:** Anna noted the Desktop App (via its bundled Personal Server) already acts like a locally hosted personal server (decrypting and re-encrypting data). She proposed bundling the Personal Server into the Desktop App for local compute.

**Maciej's synthesis:** The protocol itself is NOT opinionated about whether the Personal Server stores encrypted or unencrypted data. This is an implementation decision:

| **Implementation** | **Encrypted at Rest?** | **Rationale** |
| -- | -- | -- |
| Vana-Hosted | **MUST** encrypt | Vana ≠ data controller; legal "blind infrastructure" |
| Desktop-Bundled | MAY store unencrypted | User's security zone; enables local compute |
| Self-Hosted | User's choice | User controls their server |

**Resolution:**

* Protocol requires encryption **in transit** and **when sharing with builders**
* At-rest encryption is implementation-specific
* Desktop-Bundled Personal Server CAN access unencrypted data (user's security zone)
* See Section 4.1.4 for full specification

### **A.2 Remaining Open Questions**

1. **"Rich email client" vs "light app"** — The spec describes full functionality. UX may prioritize specific flows initially.
2. **Desktop-Bundled availability** — When Desktop App is closed, the bundled Personal Server is unavailable. Builders SHOULD fall back to ODL Cloud when enabled; otherwise requests return `server unavailable`.
3. **Delegated signature lifetime** — Delegated signature for ODL Cloud NEVER expires; users revoke by disabling ODL Cloud and deleting the Sprite.
4. **V1 chain anchoring** — Notes indicate V1 may not anchor to chain. Gateway operates as authoritative source initially.

---

## **Appendix B: Complete Flow Scenarios**

### **B.1 Scenario: New User Setup**

```
User: [Opens Vana Desktop App for first time]
App:  "Welcome to Vana. Sign in to get started."
      [Sign in with Google] [Sign in with Email]
User: [Clicks "Sign in with Google"]
App:  [Passport popup opens]
User: [Authenticates with Google]
App:  "Creating your secure identity..."
      [Background: Passport creates embedded wallet 0xABC...]
      [Background: App registers personal server at server.vana.com/u/abc123]
      [Background: Gateway records personal server registration]
App:  "You're all set! Your Vana address is 0xABC..."
      "Connect your first data source:"
      [Instagram] [ChatGPT] [YouTube] [Gmail]
User: [Clicks "Instagram"]
App:  [Opens embedded browser to instagram.com]
User: [Logs into Instagram with their credentials]
App:  [Scrapes profile, posts, likes - using user's session, user's IP]
      "Collecting your Instagram data..."
      [Background: Personal Server stores data at ~/.vana/data/instagram/]
      [Background: Personal Server encrypts data before upload to storage backend]
      [Background: Personal Server uploads encrypted blob to storage backend]
      [Background: Personal Server registers file record in DataRegistry via Gateway]
App:  "Instagram connected ✓"
      "You have 1,234 posts, 567 likes, 89 followers"
      [View Data] [Connect Another Source]
```

### **B.2 Scenario: Builder Integration**

```
Builder: [Registers as Builder via Desktop App; appUrl + public key on-chain]
         [Hosts manifest and links it via <link rel="manifest"> on https://myapp.com]
Builder: [Implements "Connect data" button using @vana/connect]
User: [Visits myapp.com]
      [Clicks "Connect data"]
Builder backend: [POST /v1/session/init to Session Relay (signed)]
Builder popup: [Displays deep link]
User: [Opens Desktop App via deep link]
Desktop App: [Fetches session details, verifies manifest, prompts consent]
User: [Clicks "Allow"]
Desktop App: [Creates grant:]
             - Signs EIP-712 grant
             - Submits to Gateway (grant → on-chain permissionId)
             - Submits signed grant + permissionId to Session Relay
Builder: [Receives grant payload via poll/webhook]
         [grantId = permissionId, user address]
Builder: [Calls Gateway: GET /v1/grants/{grantId}]
         [Receives: grant details]
Builder: [Calls Gateway: GET /v1/servers/{userAddress}]
         [Receives: Personal Server URL]
Builder: [Calls Personal Server: GET /data/instagram/profile
         with Authorization: Web3Signed ... (payload includes grantId)]
         [Receives: decrypted JSON]
         [Now has user's Instagram profile data]
Builder: [Shows personalized experience to user]
```

---

## **Appendix C: SMTP Analogy Mapping**

| **SMTP** | **DP** | **Notes** |
| -- | -- | -- |
| RFC 5321 | This spec | Protocol definition |
| Mail User Agent (MUA) | Data Portability Client | User-facing software |
| Mail Transfer Agent (MTA) | Personal Server | Protocol participant that routes/stores |
| Mail Delivery Agent (MDA) | Storage Backend | Final storage location |
| SMTP Server | Data Portability RPC | Service endpoint |
| Email address (user@domain) | Wallet address + Personal Server URL | User identifier + routing |
| Email message | Data File | Unit of data |
| SMTP EHLO | Personal Server registration | Establish identity |
| SMTP MAIL FROM | Grant creation | Authorize data flow |
| SMTP RCPT TO | Builder address | Recipient |
| SMTP DATA | Data file upload | Content transfer |
| SMTP QUIT | Grant revocation | Terminate authorization |
| Mailbox | Scope | Data category |
| Spam filter | Grant approval | User control over access |
| Bounce message | Error response | Failure notification |

---

## **Appendix D: ODL Cloud Reference Architecture**

### **D.1 Sprites.dev Integration**

ODL Cloud uses [Sprites.dev](<https://sprites.dev>) (by [Fly.io](<http://Fly.io>)) for per-user stateful MicroVMs. Key characteristics:

| **Feature** | **Benefit for Personal Server** |
| -- | -- |
| Firecracker MicroVMs | Hardware-level isolation per user |
| Stateful storage | User data persists between activations |
| Checkpoint/restore | Fast cold starts (\~300ms VM boot) |
| HTTP auto-activation | Requests wake sleeping VMs automatically |
| Pay-per-use billing | Cost scales with actual usage |
| Up to 8 CPU, 16GB RAM | Sufficient for local LLM inference |

### **D.2 Cost Model**

Based on sprites.dev pricing (as of 2026):

| **Component** | **Price** | **Typical Usage** |
| -- | -- | -- |
| CPU Time | $0.07/CPU-hour | \~$0.02-0.10/user/month |
| Memory | $0.04375/GB-hour | \~$0.05-0.20/user/month |
| Hot Storage | $0.000683/GB-hour | \~$0.01/user/month |
| Cold Storage | $0.000027/GB-hour | \~$0.02/user/month |

**Estimated monthly cost per user:**

| **Usage Pattern** | **Monthly Cost** |
| -- | -- |
| Light (few builder requests/month) | \~$0.10-0.50 |
| Medium (daily builder access) | \~$0.50-2.00 |
| Heavy (continuous access) | \~$2.00-10.00 |

### **D.3 Provisioning Flow**

```
USER                    DESKTOP APP             ODL CLOUD API          SPRITES
 │                          │                       │                       │
 │ 1. Enable                │                       │                       │
 │    "ODL Cloud"           │                       │                       │
 │─────────────────────────▶│                       │                       │
 │                          │                       │                       │
 │ 2. Sign master           │                       │                       │
 │    key message           │                       │                       │
 │◀─────────────────────────│                       │                       │
 │                          │                       │                       │
 │ 3. Signature             │                       │                       │
 │─────────────────────────▶│                       │                       │
 │                          │                       │                       │
 │                          │ 4. Create Sprite      │                       │
 │                          │    request            │                       │
 │                          │──────────────────────▶│                       │
 │                          │                       │                       │
 │                          │                       │ 5. Provision          │
 │                          │                       │    Sprite             │
 │                          │                       │──────────────────────▶│
 │                          │                       │                       │
 │                          │                       │ 6. Sprite URL         │
 │                          │                       │◀──────────────────────│
 │                          │                       │                       │
 │                          │ 7. Store encrypted    │                       │
 │                          │    signature in       │                       │
 │                          │    Sprite storage     │                       │
 │                          │──────────────────────▶│                       │
 │                          │                       │                       │
 │                          │ 8. Sync all files     │                       │
 │                          │    to Sprite          │                       │
 │                          │──────────────────────▶│                       │
 │                          │                       │                       │
 │                          │ 9. Register Sprite    │                       │
 │                          │    URL in             │                       │
 │                          │    DataPortabilityServers      │                       │
 │                          │──────────────────────▶│                       │
 │                          │                       │                       │
 │ 10. "ODL Cloud           │                       │                       │
 │     enabled!"            │                       │                       │
 │◀─────────────────────────│                       │                       │
 │                          │                       │                       │
```

### **D.4 Request Flow (Cold Start)**

```
BUILDER                 CLOUDFLARE              SPRITES                 PERSONAL SERVER
 │                          │                       │                       │
│ 1. GET /data             │                       │                       │
 │──────────────────────────▶                       │                       │
 │                          │                       │                       │
 │                          │ 2. Route to Sprite    │                       │
 │                          │──────────────────────▶│                       │
 │                          │                       │                       │
 │                          │                       │ 3. Sprite inactive    │
 │                          │                       │    → assign compute   │
 │                          │                       │    (~300ms)           │
 │                          │                       │                       │
 │                          │                       │ 4. Boot VM with       │
 │                          │                       │    persisted storage  │
 │                          │                       │                       │
 │                          │                       │ 5. Start Personal     │
 │                          │                       │    Server process     │
 │                          │                       │──────────────────────▶│
 │                          │                       │                       │
 │                          │                       │                       │ 6. Read encrypted
 │                          │                       │                       │    signature
 │                          │                       │                       │
 │                          │                       │                       │ 7. Derive master
 │                          │                       │                       │    key
 │                          │                       │                       │
 │                          │                       │                       │ 8. Decrypt data
 │                          │                       │                       │    files
 │                          │                       │                       │
 │                          │                       │ 9. Proxy request      │
 │                          │                       │    to port 8080       │
 │                          │                       │──────────────────────▶│
 │                          │                       │                       │
 │                          │                       │                       │ 10. Validate grant
 │                          │                       │                       │
 │                          │                       │                       │ 11. Serve response
 │                          │                       │◀──────────────────────│
 │                          │                       │                       │
 │ 12. Response             │                       │                       │
 │◀─────────────────────────────────────────────────│                       │
 │                          │                       │                       │
 │                          │                       │ 13. Idle timeout      │
 │                          │                       │     → sleep Sprite    │
 │                          │                       │     (billing stops)   │
 │                          │                       │                       │
```

**Total cold start latency:** \~1-2 seconds (acceptable for API calls)

### **D.5 Security Considerations**

| **Concern** | **Mitigation** |
| -- | -- |
| Vana sees user data | Sprites isolated per-user; Vana cannot access Sprite internals |
| Signature stored in Sprite | Encrypted with Sprite-specific key; only decryptable within Sprite |
| Sprite compromise | Hardware isolation (Firecracker); data encrypted at rest in storage backend |
| Sprite deletion | Data remains in storage backend; user can re-provision anytime |

---

## **Document History**

| **Version** | **Date** | **Changes** |
| -- | -- | -- |
| 0.4.0-draft | 2026-01-27 | Renaming "Sign in with Vana" to "Connect data" and "Vana Cloud" to "ODL Cloud" (temporary name) |
| 0.3.0-draft | 2026-01-26 | Standardized Session Relay flow, builder reads from Personal Server (decrypted), added versioned /data reads, clarified storage backend bulk sync, and documented builder registration steps |
| 0.2.0-draft | 2026-01-22 | Added Personal Server deployment details, sync model, MCP integration, and ODL Cloud reference architecture |
| 0.1.0-draft | 2026-01-21 | Initial draft |

---

*End of Specification*
