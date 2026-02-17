import { describe, it, expect, vi } from "vitest";
import { pino } from "pino";
import type {
  GatewayClient,
  Builder,
} from "@opendatalabs/personal-server-ts-core/gateway";
import type { GrantListItem } from "@opendatalabs/personal-server-ts-core/gateway";
import {
  GRANT_DOMAIN,
  GRANT_TYPES,
  grantToEip712Message,
} from "@opendatalabs/personal-server-ts-core/grants";
import type { GrantPayload } from "@opendatalabs/personal-server-ts-core/grants";
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from "@opendatalabs/personal-server-ts-core/test-utils";
import { grantsRoutes } from "./grants.js";

const logger = pino({ level: "silent" });
const SERVER_ORIGIN = "http://localhost:8080";

// Wallet 0 = owner/user (signs grants), Wallet 1 = builder
const owner = createTestWallet(0);
const builder = createTestWallet(1);

function createMockGateway(): GatewayClient {
  return {
    isRegisteredBuilder: vi.fn().mockResolvedValue(true),
    getBuilder: vi.fn().mockResolvedValue({
      id: "0xbuilder1",
      ownerAddress: "0xOwner",
      granteeAddress: builder.address,
      publicKey: "0x04key",
      appUrl: "https://app.example.com",
      addedAt: "2026-01-21T10:00:00.000Z",
    } satisfies Builder),
    getGrant: vi.fn().mockResolvedValue(null),
    listGrantsByUser: vi.fn().mockResolvedValue([]),
    getSchemaForScope: vi.fn().mockResolvedValue(null),
    getServer: vi.fn().mockResolvedValue(null),
    getFile: vi.fn().mockResolvedValue(null),
    listFilesSince: vi.fn().mockResolvedValue({ files: [], nextCursor: null }),
    getSchema: vi.fn().mockResolvedValue(null),
    registerFile: vi.fn().mockResolvedValue({ fileId: "file-1" }),
    createGrant: vi.fn().mockResolvedValue({ grantId: "grant-123" }),
    revokeGrant: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockServerSigner() {
  return {
    signFileRegistration: vi
      .fn()
      .mockResolvedValue("0xfilesig" as `0x${string}`),
    signGrantRegistration: vi
      .fn()
      .mockResolvedValue("0xgrantsig" as `0x${string}`),
    signGrantRevocation: vi
      .fn()
      .mockResolvedValue("0xrevokesig" as `0x${string}`),
  };
}

const futureExpiry = Math.floor(Date.now() / 1000) + 3600;

function makePayload(overrides?: Partial<GrantPayload>): GrantPayload {
  return {
    user: owner.address,
    builder: builder.address,
    scopes: ["instagram.*"],
    expiresAt: BigInt(futureExpiry),
    nonce: 1n,
    ...overrides,
  };
}

async function signGrant(payload: GrantPayload): Promise<{
  grantId: string;
  payload: {
    user: string;
    builder: string;
    scopes: string[];
    expiresAt: number;
    nonce: number;
  };
  signature: `0x${string}`;
}> {
  const signature = await owner.signTypedData({
    domain: GRANT_DOMAIN as unknown as Record<string, unknown>,
    types: GRANT_TYPES as unknown as Record<
      string,
      Array<{ name: string; type: string }>
    >,
    primaryType: "Grant",
    message: grantToEip712Message(payload) as Record<string, unknown>,
  });
  return {
    grantId: "test-grant-1",
    payload: {
      user: payload.user,
      builder: payload.builder,
      scopes: payload.scopes,
      expiresAt: Number(payload.expiresAt),
      nonce: Number(payload.nonce),
    },
    signature,
  };
}

function createApp(
  overrides?: Partial<{
    gateway: GatewayClient;
    serverSigner: ReturnType<typeof createMockServerSigner>;
  }>,
) {
  return grantsRoutes({
    logger,
    gateway: overrides?.gateway ?? createMockGateway(),
    serverOwner: owner.address,
    serverOrigin: SERVER_ORIGIN,
    serverSigner: overrides?.serverSigner ?? createMockServerSigner(),
  });
}

describe("GET /", () => {
  async function getWithOwnerAuth(app: ReturnType<typeof grantsRoutes>) {
    const auth = await buildWeb3SignedHeader({
      wallet: owner,
      aud: SERVER_ORIGIN,
      method: "GET",
      uri: "/",
    });
    return app.request("/", {
      method: "GET",
      headers: { authorization: auth },
    });
  }

  it("returns grants from gateway", async () => {
    const mockGateway = createMockGateway();
    const grants: GrantListItem[] = [
      {
        id: "0xgrant1",
        grantorAddress: owner.address,
        granteeId: "0xbuilder1",
        grant: JSON.stringify({
          scopes: ["instagram.*"],
          expiresAt: futureExpiry,
        }),
        fileIds: [],
        status: "confirmed",
        addedAt: "2025-01-01T00:00:00Z",
        revokedAt: null,
        revocationSignature: null,
      },
      {
        id: "0xgrant2",
        grantorAddress: owner.address,
        granteeId: "0xbuilder1",
        grant: JSON.stringify({
          scopes: ["twitter.*"],
          expiresAt: futureExpiry,
        }),
        fileIds: [],
        status: "confirmed",
        addedAt: "2025-01-02T00:00:00Z",
        revokedAt: null,
        revocationSignature: null,
      },
    ];
    vi.mocked(mockGateway.listGrantsByUser).mockResolvedValue(grants);

    const app = createApp({ gateway: mockGateway });
    const res = await getWithOwnerAuth(app);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.grants).toEqual(grants);
    expect(mockGateway.listGrantsByUser).toHaveBeenCalledWith(owner.address);
  });

  it("returns empty grants array when gateway has none", async () => {
    const mockGateway = createMockGateway();
    vi.mocked(mockGateway.listGrantsByUser).mockResolvedValue([]);

    const app = createApp({ gateway: mockGateway });
    const res = await getWithOwnerAuth(app);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.grants).toEqual([]);
  });

  it("returns 500 on gateway error", async () => {
    const mockGateway = createMockGateway();
    vi.mocked(mockGateway.listGrantsByUser).mockRejectedValue(
      new Error("Gateway down"),
    );

    const app = createApp({ gateway: mockGateway });
    const res = await getWithOwnerAuth(app);

    expect(res.status).toBe(500);
  });
});

describe("POST /verify", () => {
  it("valid grant + signature returns { valid: true, user, builder, scopes, expiresAt }", async () => {
    const app = createApp();
    const payload = makePayload();
    const body = await signGrant(payload);

    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.valid).toBe(true);
    expect(json.user).toBe(owner.address);
    expect(json.builder).toBe(builder.address);
    expect(json.scopes).toEqual(["instagram.*"]);
    expect(json.expiresAt).toBe(futureExpiry);
  });

  it("tampered payload (signature mismatch) returns { valid: false }", async () => {
    const app = createApp();
    const payload = makePayload();
    const body = await signGrant(payload);

    // Tamper with the scopes after signing
    body.payload.scopes = ["*"];

    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.valid).toBe(false);
    expect(json.error).toBeDefined();
  });

  it("expired grant returns { valid: false }", async () => {
    const app = createApp();
    const pastExpiry = Math.floor(Date.now() / 1000) - 3600;
    const payload = makePayload({ expiresAt: BigInt(pastExpiry) });
    const body = await signGrant(payload);

    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.valid).toBe(false);
    expect(json.error).toContain("expired");
  });

  it("expiresAt: 0 (no expiry) returns { valid: true }", async () => {
    const app = createApp();
    const payload = makePayload({ expiresAt: 0n });
    const body = await signGrant(payload);

    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.valid).toBe(true);
    expect(json.expiresAt).toBe(0);
  });

  it("missing required fields returns 400", async () => {
    const app = createApp();

    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantId: "test" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_BODY");
  });

  it("invalid JSON body returns 400", async () => {
    const app = createApp();

    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_BODY");
  });
});

describe("DELETE /:grantId", () => {
  async function deleteWithOwnerAuth(
    app: ReturnType<typeof grantsRoutes>,
    grantId: string,
  ) {
    const auth = await buildWeb3SignedHeader({
      wallet: owner,
      aud: SERVER_ORIGIN,
      method: "DELETE",
      uri: `/${grantId}`,
    });
    return app.request(`/${grantId}`, {
      method: "DELETE",
      headers: { authorization: auth },
    });
  }

  it("revokes grant via gateway and returns { revoked: true }", async () => {
    const mockGateway = createMockGateway();
    const mockSigner = createMockServerSigner();

    const app = createApp({ gateway: mockGateway, serverSigner: mockSigner });
    const res = await deleteWithOwnerAuth(app, "0xgrant1");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.revoked).toBe(true);

    expect(mockSigner.signGrantRevocation).toHaveBeenCalledWith({
      grantorAddress: owner.address,
      grantId: "0xgrant1",
    });

    expect(mockGateway.revokeGrant).toHaveBeenCalledWith({
      grantId: "0xgrant1",
      grantorAddress: owner.address,
      signature: "0xrevokesig",
    });
  });

  it("returns 400 for invalid grantId (no 0x prefix)", async () => {
    const app = createApp();
    const res = await deleteWithOwnerAuth(app, "invalid-grant-id");

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_GRANT_ID");
  });

  it("returns 500 when serverSigner is not configured", async () => {
    const app = grantsRoutes({
      logger,
      gateway: createMockGateway(),
      serverOwner: owner.address,
      serverOrigin: SERVER_ORIGIN,
    });

    const res = await deleteWithOwnerAuth(app, "0xgrant1");

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.errorCode).toBe("SERVER_SIGNER_NOT_CONFIGURED");
  });

  it("propagates gateway errors", async () => {
    const mockGateway = createMockGateway();
    vi.mocked(mockGateway.revokeGrant).mockRejectedValue(
      new Error("Gateway down"),
    );

    const app = createApp({ gateway: mockGateway });
    const res = await deleteWithOwnerAuth(app, "0xgrant1");

    expect(res.status).toBe(500);
  });
});

describe("POST /", () => {
  async function postWithOwnerAuth(
    app: ReturnType<typeof grantsRoutes>,
    body: Record<string, unknown>,
  ) {
    const bodyStr = JSON.stringify(body);
    const auth = await buildWeb3SignedHeader({
      wallet: owner,
      aud: SERVER_ORIGIN,
      method: "POST",
      uri: "/",
      bodyHash: `sha256:${await import("node:crypto").then((c) => c.createHash("sha256").update(bodyStr).digest("hex"))}`,
    });
    return app.request("/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: auth,
      },
      body: bodyStr,
    });
  }

  it("creates grant via gateway and returns grantId", async () => {
    const mockGateway = createMockGateway();
    const mockSigner = createMockServerSigner();

    const app = createApp({ gateway: mockGateway, serverSigner: mockSigner });
    const res = await postWithOwnerAuth(app, {
      granteeAddress: builder.address,
      scopes: ["instagram.*"],
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.grantId).toBe("grant-123");

    // Verify gateway.getBuilder was called with the grantee address
    expect(mockGateway.getBuilder).toHaveBeenCalledWith(builder.address);

    // Verify serverSigner.signGrantRegistration was called
    expect(mockSigner.signGrantRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        grantorAddress: owner.address,
        granteeId: "0xbuilder1",
        fileIds: [],
      }),
    );

    // Verify gateway.createGrant was called with correct params
    expect(mockGateway.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        grantorAddress: owner.address,
        granteeId: "0xbuilder1",
        fileIds: [],
        signature: "0xgrantsig",
      }),
    );
  });

  it("returns 404 when builder is not registered", async () => {
    const mockGateway = createMockGateway();
    vi.mocked(mockGateway.getBuilder).mockResolvedValue(null);

    const app = createApp({ gateway: mockGateway });
    const res = await postWithOwnerAuth(app, {
      granteeAddress: builder.address,
      scopes: ["instagram.*"],
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.errorCode).toBe("BUILDER_NOT_REGISTERED");
  });

  it("returns 500 when serverSigner is not configured", async () => {
    const app = grantsRoutes({
      logger,
      gateway: createMockGateway(),
      serverOwner: owner.address,
      serverOrigin: SERVER_ORIGIN,
      // serverSigner intentionally omitted
    });

    const res = await postWithOwnerAuth(app, {
      granteeAddress: builder.address,
      scopes: ["instagram.*"],
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.errorCode).toBe("SERVER_SIGNER_NOT_CONFIGURED");
  });

  it("returns 400 for invalid body (missing scopes)", async () => {
    const app = createApp();
    const res = await postWithOwnerAuth(app, {
      granteeAddress: builder.address,
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_BODY");
  });

  it("returns 400 for invalid body (missing granteeAddress)", async () => {
    const app = createApp();
    const res = await postWithOwnerAuth(app, {
      scopes: ["instagram.*"],
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_BODY");
  });

  it("passes optional expiresAt and nonce to grant payload", async () => {
    const mockGateway = createMockGateway();
    const mockSigner = createMockServerSigner();

    const app = createApp({ gateway: mockGateway, serverSigner: mockSigner });
    const res = await postWithOwnerAuth(app, {
      granteeAddress: builder.address,
      scopes: ["instagram.*"],
      expiresAt: 1700000000,
      nonce: 42,
    });

    expect(res.status).toBe(201);

    // Verify the grant payload passed to signer contains custom expiresAt/nonce
    const signerCall = mockSigner.signGrantRegistration.mock.calls[0][0];
    const grantPayload = JSON.parse(signerCall.grant);
    expect(grantPayload.expiresAt).toBe(1700000000);
    expect(grantPayload.nonce).toBe(42);
  });
});
