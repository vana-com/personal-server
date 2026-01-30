import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { GatewayGrantResponse } from "../grants/types.js";

import type { GrantListItem, Schema, ServerInfo } from "./client.js";
import { createGatewayClient } from "./client.js";

const BASE_URL = "https://gateway.example.com";

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
    it("returns true on 200 with registered builder", async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(200, {
        address: "0xabc",
        name: "TestBuilder",
        registered: true,
      });
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

  describe("getGrant", () => {
    it("returns parsed response on 200", async () => {
      const client = createGatewayClient(BASE_URL);
      const grantResponse: GatewayGrantResponse = {
        grantId: "grant-1",
        user: "0xuser",
        builder: "0xbuilder",
        scopes: ["instagram.*"],
        expiresAt: 9999999999,
        revoked: false,
      };
      mockFetch(200, grantResponse);
      const result = await client.getGrant("grant-1");
      expect(result).toEqual(grantResponse);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/v1/grants/grant-1`,
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
    it("returns grants array on 200", async () => {
      const client = createGatewayClient(BASE_URL);
      const grants: GrantListItem[] = [
        {
          grantId: "grant-1",
          builder: "0xbuilder1",
          scopes: ["instagram.*"],
          expiresAt: 9999999999,
          createdAt: "2025-01-01T00:00:00Z",
        },
        {
          grantId: "grant-2",
          builder: "0xbuilder2",
          scopes: ["twitter.profile"],
          expiresAt: 9999999999,
          createdAt: "2025-01-02T00:00:00Z",
        },
      ];
      mockFetch(200, grants);
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
    it("returns Schema on 200", async () => {
      const client = createGatewayClient(BASE_URL);
      const schema: Schema = {
        schemaId: "schema-1",
        scope: "instagram.profile",
        url: "https://ipfs.io/ipfs/Qm123",
      };
      mockFetch(200, schema);
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
    it("returns ServerInfo on 200", async () => {
      const client = createGatewayClient(BASE_URL);
      const serverInfo: ServerInfo = {
        address: "0xserver",
        endpoint: "https://server.example.com",
        registered: true,
        trusted: true,
      };
      mockFetch(200, serverInfo);
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
