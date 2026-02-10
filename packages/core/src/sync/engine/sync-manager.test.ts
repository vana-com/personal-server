import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { UploadWorkerDeps } from "../workers/upload.js";
import type { DownloadWorkerDeps } from "../workers/download.js";
import type { IndexManager } from "../../storage/index/manager.js";
import type { StorageAdapter } from "../../storage/adapters/interface.js";
import type { GatewayClient } from "../../gateway/client.js";
import type { ServerSigner } from "../../signing/signer.js";
import type { SyncCursor } from "../cursor.js";
import type { HierarchyManagerOptions } from "../../storage/hierarchy/index.js";
import type { Logger } from "pino";

// Mock workers so we control their behavior
vi.mock("../workers/upload.js", () => ({
  uploadAll: vi.fn(),
}));

vi.mock("../workers/download.js", () => ({
  downloadAll: vi.fn(),
}));

import { uploadAll } from "../workers/upload.js";
import { downloadAll } from "../workers/download.js";
import { createSyncManager } from "./sync-manager.js";

function makeMockLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  } as unknown as Logger;
}

function makeMockUploadDeps(): UploadWorkerDeps {
  const mockIndexManager: Partial<IndexManager> = {
    findUnsynced: vi.fn().mockReturnValue([]),
    updateFileId: vi.fn().mockReturnValue(true),
  };

  return {
    indexManager: mockIndexManager as IndexManager,
    hierarchyOptions: { dataDir: "/tmp/data" } as HierarchyManagerOptions,
    storageAdapter: {} as StorageAdapter,
    gateway: {} as GatewayClient,
    signer: {} as ServerSigner,
    masterKey: new Uint8Array(65).fill(0xaa),
    serverOwner: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
    logger: makeMockLogger(),
  };
}

function makeMockDownloadDeps(): DownloadWorkerDeps {
  const mockCursor: SyncCursor = {
    read: vi.fn().mockResolvedValue(null),
    write: vi.fn().mockResolvedValue(undefined),
  };

  return {
    indexManager: {} as IndexManager,
    hierarchyOptions: { dataDir: "/tmp/data" } as HierarchyManagerOptions,
    storageAdapter: {} as StorageAdapter,
    gateway: {} as GatewayClient,
    cursor: mockCursor,
    masterKey: new Uint8Array(65).fill(0xaa),
    serverOwner: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
    logger: makeMockLogger(),
  };
}

describe("SyncManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (uploadAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (downloadAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start() triggers an immediate sync cycle", async () => {
    const uploadDeps = makeMockUploadDeps();
    const downloadDeps = makeMockDownloadDeps();
    const manager = createSyncManager(uploadDeps, downloadDeps, {
      pollInterval: 60_000,
    });

    manager.start();

    // Flush microtasks to let the immediate cycle complete
    await vi.advanceTimersByTimeAsync(0);

    expect(uploadAll).toHaveBeenCalledTimes(1);
    expect(downloadAll).toHaveBeenCalledTimes(1);

    await manager.stop();
  });

  it("stop() prevents further cycles", async () => {
    const uploadDeps = makeMockUploadDeps();
    const downloadDeps = makeMockDownloadDeps();
    const manager = createSyncManager(uploadDeps, downloadDeps, {
      pollInterval: 10_000,
    });

    manager.start();

    // Flush the immediate cycle
    await vi.advanceTimersByTimeAsync(0);
    expect(uploadAll).toHaveBeenCalledTimes(1);

    await manager.stop();

    // Advance past multiple intervals — should NOT trigger another cycle
    await vi.advanceTimersByTimeAsync(50_000);

    expect(uploadAll).toHaveBeenCalledTimes(1);
    expect(manager.running).toBe(false);
  });

  it("trigger() runs a cycle immediately", async () => {
    const uploadDeps = makeMockUploadDeps();
    const downloadDeps = makeMockDownloadDeps();
    const manager = createSyncManager(uploadDeps, downloadDeps, {
      pollInterval: 60_000,
    });

    await manager.trigger();

    expect(uploadAll).toHaveBeenCalledTimes(1);
    expect(downloadAll).toHaveBeenCalledTimes(1);
  });

  it("getStatus() returns correct pending count", () => {
    const uploadDeps = makeMockUploadDeps();
    const downloadDeps = makeMockDownloadDeps();

    // Mock findUnsynced to return 3 pending entries
    (
      uploadDeps.indexManager.findUnsynced as ReturnType<typeof vi.fn>
    ).mockReturnValue([
      { id: 1, path: "a.json" },
      { id: 2, path: "b.json" },
      { id: 3, path: "c.json" },
    ]);

    const manager = createSyncManager(uploadDeps, downloadDeps);
    const status = manager.getStatus();

    expect(status.pendingFiles).toBe(3);
    expect(status.enabled).toBe(true);
    expect(status.running).toBe(false);
    expect(status.lastSync).toBeNull();
    expect(status.errors).toEqual([]);
  });

  it("getStatus().running reflects lifecycle", async () => {
    const uploadDeps = makeMockUploadDeps();
    const downloadDeps = makeMockDownloadDeps();
    const manager = createSyncManager(uploadDeps, downloadDeps, {
      pollInterval: 60_000,
    });

    expect(manager.running).toBe(false);
    expect(manager.getStatus().running).toBe(false);

    manager.start();
    expect(manager.running).toBe(true);
    expect(manager.getStatus().running).toBe(true);

    // Flush the immediate cycle
    await vi.advanceTimersByTimeAsync(0);

    await manager.stop();
    expect(manager.running).toBe(false);
    expect(manager.getStatus().running).toBe(false);
  });

  it("upload errors are captured in getStatus().errors", async () => {
    const uploadDeps = makeMockUploadDeps();
    const downloadDeps = makeMockDownloadDeps();

    (uploadAll as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );

    const manager = createSyncManager(uploadDeps, downloadDeps);

    await manager.trigger();

    const status = manager.getStatus();
    expect(status.errors).toHaveLength(1);
    expect(status.errors[0].message).toContain("Storage unavailable");
    expect(status.errors[0].fileId).toBeNull();
    expect(status.errors[0].timestamp).toBeTruthy();
  });

  it("crash recovery: unsynced entries from previous session are uploaded", async () => {
    const uploadDeps = makeMockUploadDeps();
    const downloadDeps = makeMockDownloadDeps();

    (uploadAll as ReturnType<typeof vi.fn>).mockResolvedValue([
      { path: "leftover.json", fileId: "file-001", url: "https://example.com" },
    ]);

    const manager = createSyncManager(uploadDeps, downloadDeps, {
      pollInterval: 60_000,
    });

    manager.start();

    // Flush the immediate cycle (crash recovery)
    await vi.advanceTimersByTimeAsync(0);

    expect(uploadAll).toHaveBeenCalledTimes(1);

    await manager.stop();
  });

  it("multiple start() calls are idempotent (no duplicate intervals)", async () => {
    const uploadDeps = makeMockUploadDeps();
    const downloadDeps = makeMockDownloadDeps();
    const manager = createSyncManager(uploadDeps, downloadDeps, {
      pollInterval: 10_000,
    });

    manager.start();
    manager.start(); // no-op
    manager.start(); // no-op

    // Flush the immediate cycle
    await vi.advanceTimersByTimeAsync(0);

    // Only one initial cycle should have run
    expect(uploadAll).toHaveBeenCalledTimes(1);

    // Advance by one interval period
    await vi.advanceTimersByTimeAsync(10_000);

    // Should have one more cycle from the single interval
    expect(uploadAll).toHaveBeenCalledTimes(2);

    await manager.stop();
  });
});
