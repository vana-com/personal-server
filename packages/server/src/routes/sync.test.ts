import { describe, it, expect, vi } from "vitest";
import { pino } from "pino";
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from "@opendatalabs/personal-server-ts-core/test-utils";
import type { SyncManager } from "@opendatalabs/personal-server-ts-core/sync";
import type { SyncStatus } from "@opendatalabs/personal-server-ts-core/sync";
import { syncRoutes } from "./sync.js";

const logger = pino({ level: "silent" });
const SERVER_ORIGIN = "http://localhost:8080";
const owner = createTestWallet(0);

function createMockSyncManager(overrides?: Partial<SyncManager>): SyncManager {
  const status: SyncStatus = {
    enabled: true,
    running: true,
    lastSync: "2026-01-21T10:00:00.000Z",
    lastProcessedTimestamp: "2026-01-21T09:00:00.000Z",
    pendingFiles: 3,
    errors: [],
  };

  return {
    start: vi.fn(),
    stop: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    trigger: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getStatus: vi.fn<() => SyncStatus>().mockReturnValue(status),
    notifyNewData: vi.fn(),
    running: true,
    ...overrides,
  };
}

describe("syncRoutes", () => {
  describe("with syncManager (sync enabled)", () => {
    const mockSyncManager = createMockSyncManager();
    const app = syncRoutes({
      logger,
      serverOrigin: SERVER_ORIGIN,
      serverOwner: owner.address,
      syncManager: mockSyncManager,
    });

    describe("POST /trigger", () => {
      it("returns 202 and triggers sync", async () => {
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
        expect(json).toEqual({
          status: "started",
          message: "Sync triggered",
        });
        expect(mockSyncManager.trigger).toHaveBeenCalled();
      });
    });

    describe("GET /status", () => {
      it("returns SyncStatus from syncManager", async () => {
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
          enabled: true,
          running: true,
          lastSync: "2026-01-21T10:00:00.000Z",
          lastProcessedTimestamp: "2026-01-21T09:00:00.000Z",
          pendingFiles: 3,
          errors: [],
        });
        expect(mockSyncManager.getStatus).toHaveBeenCalled();
      });
    });

    describe("POST /file/:fileId", () => {
      it("returns 202 and triggers full sync", async () => {
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
        expect(mockSyncManager.trigger).toHaveBeenCalled();
      });
    });
  });

  describe("without syncManager (sync disabled)", () => {
    const app = syncRoutes({
      logger,
      serverOrigin: SERVER_ORIGIN,
      serverOwner: owner.address,
      syncManager: null,
    });

    describe("POST /trigger", () => {
      it("returns 200 with disabled status", async () => {
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

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({
          status: "disabled",
          message: "Sync is not enabled",
        });
      });
    });

    describe("GET /status", () => {
      it("returns disabled sync status", async () => {
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
          enabled: false,
          running: false,
          lastSync: null,
          lastProcessedTimestamp: null,
          pendingFiles: 0,
          errors: [],
        });
      });
    });

    describe("POST /file/:fileId", () => {
      it("returns 200 with disabled status", async () => {
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

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({
          fileId: "0x123",
          status: "disabled",
          message: "Sync is not enabled",
        });
      });
    });
  });
});
