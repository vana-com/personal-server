import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { GatewayGrantResponse } from "../grants/types.js";

import type { GrantListItem, Schema, ServerInfo, Builder } from "./client.js";
import { createGatewayClient } from "./client.js";

const BASE_URL = "https://gateway.example.com";

/** Wrap data in gateway envelope format */
function envelope<T>(data: T) {
  return {
    data,
    proof: {
      signature: "0xproof",
      timestamp: "2026-01-21T10:00:00.000Z",
      gatewayAddress: "0xGateway",
      requestHash: "0xreqhash",
      responseHash: "0xreshash",
      userSignature: "0xusersig",
      status: "confirmed",
      chainBlockHeight: 1000,
    },
  };
}

describe("GatewayClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, body?: unknown) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText:
        status === 200 ? "OK" : status === 404 ? "Not Found" : "Error",
      json: async () => body,
    });
  }

  function mockFetchError(error: Error) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);
  }

  describe("isRegisteredBuilder", () => {
    it("returns true on 200 with builder data", async () => {
      const client = createGatewayClient(BASE_URL);
      const builderData: Builder = {
        id: "0xbuilder1",
        ownerAddress: "0xOwner",
        granteeAddress: "0xabc",
        publicKey: "0x04key",
        appUrl: "https://app.example.com",
        addedAt: "2026-01-21T10:00:00.000Z",
      };
      mockFetch(200, envelope(builderData));
      const result = await client.isRegisteredBuilder("0xabc");
      expect(result).toBe(true);
    });

    it("returns false on 404", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(404);
      const result = await client.isRegisteredBuilder("0xabc");
      expect(result).toBe(false);
    });

    it("throws on network error", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetchError(new Error("Network failure"));
      await expect(client.isRegisteredBuilder("0xabc")).rejects.toThrow(
        "Network failure",
      );
    });
  });

  describe("getBuilder", () => {
    it("unwraps envelope and returns builder data on 200", async () => {
      const client = createGatewayClient(BASE_URL);
      const builderData: Builder = {
        id: "0xbuilder1",
        ownerAddress: "0xOwner",
        granteeAddress: "0xabc",
        publicKey: "0x04key",
        appUrl: "https://app.example.com",
        addedAt: "2026-01-21T10:00:00.000Z",
      };
      mockFetch(200, envelope(builderData));
      const result = await client.getBuilder("0xabc");
      expect(result).toEqual(builderData);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/v1/builders/0xabc`,
      );
    });

    it("returns null on 404", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(404);
      const result = await client.getBuilder("0xabc");
      expect(result).toBeNull();
    });
  });

  describe("getGrant", () => {
    it("unwraps envelope and returns grant data on 200", async () => {
      const client = createGatewayClient(BASE_URL);
      const grantResponse: GatewayGrantResponse = {
        id: "0xgrant1",
        grantorAddress: "0xuser",
        granteeId: "0xbuilder1",
        grant: JSON.stringify({
          scopes: ["instagram.*"],
          expiresAt: 9999999999,
        }),
        fileIds: [],
        status: "confirmed",
        addedAt: "2026-01-21T10:00:00.000Z",
        revokedAt: null,
        revocationSignature: null,
      };
      mockFetch(200, envelope(grantResponse));
      const result = await client.getGrant("0xgrant1");
      expect(result).toEqual(grantResponse);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/v1/grants/0xgrant1`,
      );
    });

    it("returns null on 404", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(404);
      const result = await client.getGrant("nonexistent");
      expect(result).toBeNull();
    });

    it("throws on network error", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetchError(new Error("Network failure"));
      await expect(client.getGrant("grant-1")).rejects.toThrow(
        "Network failure",
      );
    });
  });

  describe("listGrantsByUser", () => {
    it("unwraps envelope and returns grants array on 200", async () => {
      const client = createGatewayClient(BASE_URL);
      const grants: GrantListItem[] = [
        {
          id: "0xgrant1",
          grantorAddress: "0xuser",
          granteeId: "0xbuilder1",
          grant: JSON.stringify({
            scopes: ["instagram.*"],
            expiresAt: 9999999999,
          }),
          fileIds: [],
          status: "confirmed",
          addedAt: "2026-01-21T10:00:00.000Z",
          revokedAt: null,
          revocationSignature: null,
        },
        {
          id: "0xgrant2",
          grantorAddress: "0xuser",
          granteeId: "0xbuilder2",
          grant: JSON.stringify({
            scopes: ["twitter.profile"],
            expiresAt: 9999999999,
          }),
          fileIds: [],
          status: "confirmed",
          addedAt: "2026-01-22T10:00:00.000Z",
          revokedAt: null,
          revocationSignature: null,
        },
      ];
      mockFetch(200, envelope(grants));
      const result = await client.listGrantsByUser("0xuser");
      expect(result).toEqual(grants);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/v1/grants?user=0xuser`,
      );
    });

    it("returns empty array on 404", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(404);
      const result = await client.listGrantsByUser("0xuser");
      expect(result).toEqual([]);
    });
  });

  describe("getSchemaForScope", () => {
    it("unwraps envelope and returns Schema on 200", async () => {
      const client = createGatewayClient(BASE_URL);
      const schema: Schema = {
        id: "0xschema1",
        ownerAddress: "0xOwner",
        name: "instagram.profile",
        definitionUrl: "https://ipfs.io/ipfs/Qm123",
        scope: "instagram.profile",
        addedAt: "2026-01-21T10:00:00.000Z",
      };
      mockFetch(200, envelope(schema));
      const result = await client.getSchemaForScope("instagram.profile");
      expect(result).toEqual(schema);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/v1/schemas?scope=instagram.profile`,
      );
    });

    it("returns null on 404", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(404);
      const result = await client.getSchemaForScope("nonexistent.scope");
      expect(result).toBeNull();
    });
  });

  describe("getServer", () => {
    it("unwraps envelope and returns ServerInfo on 200", async () => {
      const client = createGatewayClient(BASE_URL);
      const serverInfo: ServerInfo = {
        id: "0xserver1",
        ownerAddress: "0xOwner",
        serverAddress: "0xserver",
        publicKey: "0x04serverkey",
        serverUrl: "https://server.example.com",
        addedAt: "2026-01-21T10:00:00.000Z",
      };
      mockFetch(200, envelope(serverInfo));
      const result = await client.getServer("0xserver");
      expect(result).toEqual(serverInfo);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/v1/servers/0xserver`,
      );
    });
  });

  describe("registerFile", () => {
    it("sends POST with Web3Signed auth header and returns fileId", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(200, { fileId: "file-123" });
      const result = await client.registerFile({
        ownerAddress: "0xOwner",
        url: "https://storage.example.com/file.json",
        schemaId: "0xschema",
        signature: "0xsig",
      });
      expect(result).toEqual({ fileId: "file-123" });
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(fetchCall[0]).toBe(`${BASE_URL}/v1/files`);
      expect(fetchCall[1].method).toBe("POST");
      expect(fetchCall[1].headers.Authorization).toBe("Web3Signed 0xsig");
    });

    it("sends body with ownerAddress, url, schemaId (not signature)", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(200, { fileId: "file-123" });
      await client.registerFile({
        ownerAddress: "0xOwner",
        url: "https://storage.example.com/file.json",
        schemaId: "0xschema",
        signature: "0xsig",
      });
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body).toEqual({
        ownerAddress: "0xOwner",
        url: "https://storage.example.com/file.json",
        schemaId: "0xschema",
      });
      expect(body).not.toHaveProperty("signature");
    });

    it("sends Content-Type application/json header", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(200, { fileId: "file-123" });
      await client.registerFile({
        ownerAddress: "0xOwner",
        url: "https://storage.example.com/file.json",
        schemaId: "0xschema",
        signature: "0xsig",
      });
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
    });

    it("treats 409 as success (idempotent)", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(409, { fileId: "file-123" });
      const result = await client.registerFile({
        ownerAddress: "0xOwner",
        url: "https://storage.example.com/file.json",
        schemaId: "0xschema",
        signature: "0xsig",
      });
      expect(result).toEqual({ fileId: "file-123" });
    });

    it("throws on non-200/409 errors", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(500);
      await expect(
        client.registerFile({
          ownerAddress: "0xOwner",
          url: "url",
          schemaId: "0x",
          signature: "0xsig",
        }),
      ).rejects.toThrow("Gateway error: 500");
    });

    it("throws on network error", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetchError(new Error("Network failure"));
      await expect(
        client.registerFile({
          ownerAddress: "0xOwner",
          url: "url",
          schemaId: "0x",
          signature: "0xsig",
        }),
      ).rejects.toThrow("Network failure");
    });
  });

  describe("createGrant", () => {
    it("sends POST with Web3Signed auth header and returns grantId", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(200, { grantId: "grant-123" });
      const result = await client.createGrant({
        grantorAddress: "0xGrantor",
        granteeId: "0xGrantee",
        grant: '{"scopes":["*"]}',
        fileIds: ["1", "2"],
        signature: "0xsig",
      });
      expect(result).toEqual({ grantId: "grant-123" });
    });

    it("sends body with grantorAddress, granteeId, grant, fileIds (not signature)", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(200, { grantId: "grant-123" });
      await client.createGrant({
        grantorAddress: "0xGrantor",
        granteeId: "0xGrantee",
        grant: '{"scopes":["*"]}',
        fileIds: ["1", "2"],
        signature: "0xsig",
      });
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body).toEqual({
        grantorAddress: "0xGrantor",
        granteeId: "0xGrantee",
        grant: '{"scopes":["*"]}',
        fileIds: ["1", "2"],
      });
      expect(body).not.toHaveProperty("signature");
    });

    it("sends Content-Type application/json header", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(200, { grantId: "grant-123" });
      await client.createGrant({
        grantorAddress: "0xGrantor",
        granteeId: "0xGrantee",
        grant: '{"scopes":["*"]}',
        fileIds: [],
        signature: "0xsig",
      });
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
    });

    it("treats 409 as success (idempotent)", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(409, { grantId: "grant-123" });
      const result = await client.createGrant({
        grantorAddress: "0xGrantor",
        granteeId: "0xGrantee",
        grant: '{"scopes":["*"]}',
        fileIds: [],
        signature: "0xsig",
      });
      expect(result).toEqual({ grantId: "grant-123" });
    });

    it("throws on non-200/409 errors", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(500);
      await expect(
        client.createGrant({
          grantorAddress: "0xGrantor",
          granteeId: "0xGrantee",
          grant: '{"scopes":["*"]}',
          fileIds: [],
          signature: "0xsig",
        }),
      ).rejects.toThrow("Gateway error: 500");
    });

    it("throws on network error", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetchError(new Error("Network failure"));
      await expect(
        client.createGrant({
          grantorAddress: "0xGrantor",
          granteeId: "0xGrantee",
          grant: '{"scopes":["*"]}',
          fileIds: [],
          signature: "0xsig",
        }),
      ).rejects.toThrow("Network failure");
    });
  });

  describe("revokeGrant", () => {
    it("sends POST to revoke endpoint", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(200, {});
      await client.revokeGrant({
        grantId: "grant-123",
        grantorAddress: "0xGrantor",
        signature: "0xsig",
      });
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(fetchCall[0]).toBe(`${BASE_URL}/v1/grants/grant-123/revoke`);
      expect(fetchCall[1].method).toBe("POST");
      expect(fetchCall[1].headers.Authorization).toBe("Web3Signed 0xsig");
    });

    it("sends body with grantorAddress only (not signature or grantId)", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(200, {});
      await client.revokeGrant({
        grantId: "grant-123",
        grantorAddress: "0xGrantor",
        signature: "0xsig",
      });
      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body).toEqual({ grantorAddress: "0xGrantor" });
      expect(body).not.toHaveProperty("signature");
      expect(body).not.toHaveProperty("grantId");
    });

    it("treats 409 as success (already revoked)", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(409, {});
      await expect(
        client.revokeGrant({
          grantId: "grant-123",
          grantorAddress: "0xGrantor",
          signature: "0xsig",
        }),
      ).resolves.toBeUndefined();
    });

    it("throws on non-200/409 errors", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(500);
      await expect(
        client.revokeGrant({
          grantId: "grant-123",
          grantorAddress: "0xGrantor",
          signature: "0xsig",
        }),
      ).rejects.toThrow("Gateway error: 500");
    });
  });

  describe("error handling for new methods", () => {
    it("all throw on non-404 errors", async () => {
      const client = createGatewayClient(BASE_URL);

      mockFetch(500);
      await expect(client.listGrantsByUser("0xuser")).rejects.toThrow(
        "Gateway error: 500",
      );

      mockFetch(503);
      await expect(client.getSchemaForScope("scope")).rejects.toThrow(
        "Gateway error: 503",
      );

      mockFetch(500);
      await expect(client.getServer("0xaddr")).rejects.toThrow(
        "Gateway error: 500",
      );
    });
  });
});
