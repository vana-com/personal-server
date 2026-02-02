import { describe, it, expect } from "vitest";
import { pino } from "pino";
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from "@opendatalabs/personal-server-ts-core/test-utils";
import { syncRoutes } from "./sync.js";

const logger = pino({ level: "silent" });
const SERVER_ORIGIN = "http://localhost:8080";
const owner = createTestWallet(0);

describe("syncRoutes", () => {
  const app = syncRoutes({
    logger,
    serverOrigin: SERVER_ORIGIN,
    serverOwner: owner.address,
  });

  describe("POST /trigger", () => {
    it("returns 202 with status started", async () => {
      const auth = await buildWeb3SignedHeader({
        wallet: owner,
        aud: SERVER_ORIGIN,
        method: "POST",
        uri: "/trigger",
      });
      const res = await app.request("/trigger", {
        method: "POST",
        headers: { authorization: auth },
      });

      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json).toEqual({ status: "started", message: "Sync triggered" });
    });
  });

  describe("GET /status", () => {
    it("returns 200 with stub sync status", async () => {
      const auth = await buildWeb3SignedHeader({
        wallet: owner,
        aud: SERVER_ORIGIN,
        method: "GET",
        uri: "/status",
      });
      const res = await app.request("/status", {
        method: "GET",
        headers: { authorization: auth },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        lastSync: null,
        lastProcessedTimestamp: null,
        pendingFiles: 0,
        errors: [],
      });
    });
  });

  describe("POST /file/:fileId", () => {
    it("returns 202 with fileId and status started", async () => {
      const auth = await buildWeb3SignedHeader({
        wallet: owner,
        aud: SERVER_ORIGIN,
        method: "POST",
        uri: "/file/0x123",
      });
      const res = await app.request("/file/0x123", {
        method: "POST",
        headers: { authorization: auth },
      });

      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json).toEqual({ fileId: "0x123", status: "started" });
    });
  });
});
