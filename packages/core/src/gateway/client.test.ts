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
