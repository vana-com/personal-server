import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createWeb3AuthMiddleware } from "./web3-auth.js";
import { createGrantCheckMiddleware } from "./grant-check.js";
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from "@opendatalabs/personal-server-ts-core/test-utils";
import type {
  GatewayClient,
  Builder,
} from "@opendatalabs/personal-server-ts-core/gateway";
import type { GatewayGrantResponse } from "@opendatalabs/personal-server-ts-core/grants";

const SERVER_ORIGIN = "http://localhost:8080";
const wallet = createTestWallet(0);

const BUILDER_ID = "0xbuilder1";
const OTHER_BUILDER_ID = "0xbuilder2";

function createMockGateway(
  overrides: Partial<GatewayClient> = {},
): GatewayClient {
  return {
    isRegisteredBuilder: vi.fn().mockResolvedValue(true),
    getBuilder: vi.fn().mockResolvedValue({
      id: BUILDER_ID,
      ownerAddress: "0xOwner",
      granteeAddress: wallet.address,
      publicKey: "0x04key",
      appUrl: "https://app.example.com",
      addedAt: "2026-01-21T10:00:00.000Z",
    } satisfies Builder),
    getGrant: vi.fn().mockResolvedValue(null),
    listGrantsByUser: vi.fn().mockResolvedValue([]),
    getSchemaForScope: vi.fn().mockResolvedValue(null),
    getServer: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeGrant(
  overrides: Partial<GatewayGrantResponse> = {},
): GatewayGrantResponse {
  return {
    id: "grant-123",
    grantorAddress: "0xOwnerAddress",
    granteeId: BUILDER_ID,
    grant: JSON.stringify({
      user: "0xOwnerAddress",
      builder: wallet.address,
      scopes: ["instagram.*"],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }),
    fileIds: [],
    status: "confirmed",
    addedAt: "2026-01-21T10:00:00.000Z",
    revokedAt: null,
    revocationSignature: null,
    ...overrides,
  };
}

function createApp(
  gateway: GatewayClient,
  serverOwner: `0x${string}` = "0xOwnerAddress",
) {
  const app = new Hono();
  const web3Auth = createWeb3AuthMiddleware(SERVER_ORIGIN);
  const grantCheck = createGrantCheckMiddleware({ gateway, serverOwner });

  app.get("/v1/data/:scope", web3Auth, grantCheck, (c) => {
    const grant = c.get("grant");
    return c.json({ ok: true, grant });
  });

  return app;
}

async function makeAuthRequest(
  app: Hono,
  options: { scope?: string; grantId?: string; useWallet?: typeof wallet } = {},
) {
  const {
    scope = "instagram.profile",
    grantId = "grant-123",
    useWallet = wallet,
  } = options;
  const header = await buildWeb3SignedHeader({
    wallet: useWallet,
    aud: SERVER_ORIGIN,
    method: "GET",
    uri: `/v1/data/${scope}`,
    grantId,
  });
  return app.request(`/v1/data/${scope}`, {
    headers: { Authorization: header },
  });
}

describe("createGrantCheckMiddleware", () => {
  it("valid grant calls next and sets grant on context", async () => {
    const grant = makeGrant();
    const gateway = createMockGateway({
      getGrant: vi.fn().mockResolvedValue(grant),
    });
    const app = createApp(gateway);

    const res = await makeAuthRequest(app);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      grant: GatewayGrantResponse;
    };
    expect(json.ok).toBe(true);
    expect(json.grant.id).toBe("grant-123");
    expect(gateway.getGrant).toHaveBeenCalledWith("grant-123");
  });

  it("missing grantId returns 403 GRANT_REQUIRED", async () => {
    const gateway = createMockGateway();
    const app = createApp(gateway);

    const header = await buildWeb3SignedHeader({
      wallet,
      aud: SERVER_ORIGIN,
      method: "GET",
      uri: "/v1/data/instagram.profile",
      // no grantId
    });
    const res = await app.request("/v1/data/instagram.profile", {
      headers: { Authorization: header },
    });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { errorCode: string } };
    expect(json.error.errorCode).toBe("GRANT_REQUIRED");
  });

  it("grant not found returns 403 GRANT_REQUIRED", async () => {
    const gateway = createMockGateway({
      getGrant: vi.fn().mockResolvedValue(null),
    });
    const app = createApp(gateway);

    const res = await makeAuthRequest(app);

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { errorCode: string } };
    expect(json.error.errorCode).toBe("GRANT_REQUIRED");
  });

  it("revoked grant returns 403 GRANT_REVOKED", async () => {
    const grant = makeGrant({ revokedAt: "2026-01-25T10:00:00.000Z" });
    const gateway = createMockGateway({
      getGrant: vi.fn().mockResolvedValue(grant),
    });
    const app = createApp(gateway);

    const res = await makeAuthRequest(app);

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { errorCode: string } };
    expect(json.error.errorCode).toBe("GRANT_REVOKED");
  });

  it("expired grant returns 403 GRANT_EXPIRED", async () => {
    const grant = makeGrant({
      grant: JSON.stringify({
        scopes: ["instagram.*"],
        expiresAt: Math.floor(Date.now() / 1000) - 3600,
      }),
    });
    const gateway = createMockGateway({
      getGrant: vi.fn().mockResolvedValue(grant),
    });
    const app = createApp(gateway);

    const res = await makeAuthRequest(app);

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { errorCode: string } };
    expect(json.error.errorCode).toBe("GRANT_EXPIRED");
  });

  it("scope mismatch returns 403 SCOPE_MISMATCH", async () => {
    const grant = makeGrant({
      grant: JSON.stringify({
        scopes: ["twitter.*"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
    const gateway = createMockGateway({
      getGrant: vi.fn().mockResolvedValue(grant),
    });
    const app = createApp(gateway);

    const res = await makeAuthRequest(app, { scope: "instagram.profile" });

    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { errorCode: string } };
    expect(json.error.errorCode).toBe("SCOPE_MISMATCH");
  });

  it("grantee mismatch returns 401 INVALID_SIGNATURE", async () => {
    // Grant is for a different builder ID
    const grant = makeGrant({ granteeId: OTHER_BUILDER_ID });
    const gateway = createMockGateway({
      getGrant: vi.fn().mockResolvedValue(grant),
      // getBuilder returns builder with BUILDER_ID, but grant has OTHER_BUILDER_ID
    });
    const app = createApp(gateway);

    const res = await makeAuthRequest(app);

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { errorCode: string } };
    expect(json.error.errorCode).toBe("INVALID_SIGNATURE");
  });

  it("builder not found returns 401 INVALID_SIGNATURE", async () => {
    const grant = makeGrant();
    const gateway = createMockGateway({
      getGrant: vi.fn().mockResolvedValue(grant),
      getBuilder: vi.fn().mockResolvedValue(null),
    });
    const app = createApp(gateway);

    const res = await makeAuthRequest(app);

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { errorCode: string } };
    expect(json.error.errorCode).toBe("INVALID_SIGNATURE");
  });

  it("expiresAt=0 (no expiry) passes", async () => {
    const grant = makeGrant({
      grant: JSON.stringify({
        scopes: ["instagram.*"],
        expiresAt: 0,
      }),
    });
    const gateway = createMockGateway({
      getGrant: vi.fn().mockResolvedValue(grant),
    });
    const app = createApp(gateway);

    const res = await makeAuthRequest(app);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });
});
