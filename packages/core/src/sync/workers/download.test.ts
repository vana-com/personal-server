import { describe, it, expect, vi, beforeEach } from "vitest";

import type { DownloadWorkerDeps } from "./download.js";
import { downloadOne, downloadAll } from "./download.js";
import type { FileRecord } from "../types.js";
import type { IndexManager } from "../../storage/index/manager.js";
import type { IndexEntry } from "../../storage/index/types.js";
import type { StorageAdapter } from "../../storage/adapters/interface.js";
import type { GatewayClient, Schema } from "../../gateway/client.js";
import type { SyncCursor } from "../cursor.js";
import type { HierarchyManagerOptions } from "../../storage/hierarchy/index.js";
import type { DataFileEnvelope } from "../../schemas/data-file.js";
import type { Logger } from "pino";

// Mock the filesystem-dependent modules
vi.mock("../../storage/hierarchy/index.js", () => ({
  writeDataFile: vi.fn(),
}));

vi.mock("../../keys/derive.js", () => ({
  deriveScopeKey: vi.fn(),
}));

vi.mock("../../storage/encryption/index.js", () => ({
  decryptWithPassword: vi.fn(),
}));

import { writeDataFile } from "../../storage/hierarchy/index.js";
import { deriveScopeKey } from "../../keys/derive.js";
import { decryptWithPassword } from "../../storage/encryption/index.js";

const SCOPE = "instagram.profile";
const COLLECTED_AT = "2026-01-21T10:00:00Z";
const OWNER = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";
const SCHEMA_ID =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const FILE_ID = "file-001";
const STORAGE_URL = `https://storage.vana.com/v1/blobs/${OWNER}/${SCOPE}/${COLLECTED_AT}`;

function makeFileRecord(overrides?: Partial<FileRecord>): FileRecord {
  return {
    fileId: FILE_ID,
    owner: OWNER,
    url: STORAGE_URL,
    schemaId: SCHEMA_ID,
    createdAt: "2026-01-21T10:00:00Z",
    ...overrides,
  };
}

function makeEnvelope(): DataFileEnvelope {
  return {
    version: "1.0",
    scope: SCOPE,
    collectedAt: COLLECTED_AT,
    data: { username: "testuser" },
  };
}

function makeSchema(): Schema {
  return {
    id: SCHEMA_ID,
    ownerAddress: OWNER,
    name: "instagram-profile",
    definitionUrl: "https://schemas.vana.com/instagram/profile.json",
    scope: SCOPE,
    addedAt: "2026-01-01T00:00:00Z",
  };
}

function makeMockDeps(): DownloadWorkerDeps {
  const mockIndexManager: Partial<IndexManager> = {
    findByFileId: vi.fn().mockReturnValue(undefined),
    insert: vi.fn().mockImplementation((entry) => ({
      id: 1,
      createdAt: "2026-01-21T10:00:00Z",
      ...entry,
    })),
  };

  const mockStorageAdapter: Partial<StorageAdapter> = {
    download: vi.fn().mockResolvedValue(new Uint8Array([0xde, 0xad])),
  };

  const mockGateway: Partial<GatewayClient> = {
    getSchema: vi.fn().mockResolvedValue(makeSchema()),
    listFilesSince: vi.fn().mockResolvedValue({ files: [], cursor: null }),
  };

  const mockCursor: SyncCursor = {
    read: vi.fn().mockResolvedValue(null),
    write: vi.fn().mockResolvedValue(undefined),
  };

  const mockLogger: Partial<Logger> = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  return {
    indexManager: mockIndexManager as IndexManager,
    hierarchyOptions: { dataDir: "/tmp/data" } as HierarchyManagerOptions,
    storageAdapter: mockStorageAdapter as StorageAdapter,
    gateway: mockGateway as GatewayClient,
    cursor: mockCursor,
    masterKey: new Uint8Array(65).fill(0xaa),
    serverOwner: OWNER,
    logger: mockLogger as Logger,
  };
}

describe("download worker", () => {
  const SCOPE_KEY = new Uint8Array(32).fill(0xbb);
  const SCOPE_KEY_HEX = Buffer.from(SCOPE_KEY).toString("hex");
  const RELATIVE_PATH = `${SCOPE}/${COLLECTED_AT}.json`;

  beforeEach(() => {
    vi.clearAllMocks();

    const envelope = makeEnvelope();
    const plaintextBytes = new TextEncoder().encode(JSON.stringify(envelope));

    (deriveScopeKey as ReturnType<typeof vi.fn>).mockReturnValue(SCOPE_KEY);
    (decryptWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue(
      plaintextBytes,
    );
    (writeDataFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: `/tmp/data/${RELATIVE_PATH}`,
      relativePath: RELATIVE_PATH,
      sizeBytes: 128,
    });
  });

  describe("downloadOne", () => {
    it("skips if fileId already in index (dedup)", async () => {
      const deps = makeMockDeps();
      const existingEntry: IndexEntry = {
        id: 1,
        fileId: FILE_ID,
        path: RELATIVE_PATH,
        scope: SCOPE,
        collectedAt: COLLECTED_AT,
        createdAt: "2026-01-21T10:00:00Z",
        sizeBytes: 128,
      };
      (
        deps.indexManager.findByFileId as ReturnType<typeof vi.fn>
      ).mockReturnValue(existingEntry);

      const record = makeFileRecord();
      const result = await downloadOne(deps, record);

      expect(result).toBeNull();
      expect(deps.storageAdapter.download).not.toHaveBeenCalled();
    });

    it("downloads, decrypts, writes, and indexes file", async () => {
      const deps = makeMockDeps();
      const record = makeFileRecord();

      const result = await downloadOne(deps, record);

      // Verify download was called
      expect(deps.storageAdapter.download).toHaveBeenCalledWith(STORAGE_URL);

      // Verify decrypt was called with correct key
      expect(decryptWithPassword).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        SCOPE_KEY_HEX,
      );

      // Verify write was called with envelope
      expect(writeDataFile).toHaveBeenCalledWith(deps.hierarchyOptions, {
        version: "1.0",
        scope: SCOPE,
        collectedAt: COLLECTED_AT,
        data: { username: "testuser" },
      });

      // Verify index insert was called
      expect(deps.indexManager.insert).toHaveBeenCalledWith({
        fileId: FILE_ID,
        path: RELATIVE_PATH,
        scope: SCOPE,
        collectedAt: COLLECTED_AT,
        sizeBytes: 128,
      });

      // Verify result
      expect(result).toEqual({
        fileId: FILE_ID,
        scope: SCOPE,
        collectedAt: COLLECTED_AT,
        path: RELATIVE_PATH,
      });
    });

    it("resolves schemaId → scope via gateway.getSchema", async () => {
      const deps = makeMockDeps();
      const record = makeFileRecord();

      await downloadOne(deps, record);

      expect(deps.gateway.getSchema).toHaveBeenCalledWith(SCHEMA_ID);
      expect(deriveScopeKey).toHaveBeenCalledWith(deps.masterKey, SCOPE);
    });

    it("validates envelope against DataFileEnvelopeSchema", async () => {
      const deps = makeMockDeps();
      const record = makeFileRecord();

      // Return invalid envelope (missing required fields)
      const invalidPlaintext = new TextEncoder().encode(
        JSON.stringify({ invalid: true }),
      );
      (decryptWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue(
        invalidPlaintext,
      );

      await expect(downloadOne(deps, record)).rejects.toThrow();
    });

    it("throws on decrypt failure (wrong key / corrupted)", async () => {
      const deps = makeMockDeps();
      const record = makeFileRecord();

      (decryptWithPassword as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Error decrypting message: Session key decryption failed."),
      );

      await expect(downloadOne(deps, record)).rejects.toThrow(
        "Session key decryption failed",
      );
    });
  });

  describe("downloadAll", () => {
    it("polls gateway with cursor from config", async () => {
      const deps = makeMockDeps();
      const timestamp = "2026-01-20T00:00:00Z";
      (deps.cursor.read as ReturnType<typeof vi.fn>).mockResolvedValue(
        timestamp,
      );

      await downloadAll(deps);

      expect(deps.cursor.read).toHaveBeenCalled();
      expect(deps.gateway.listFilesSince).toHaveBeenCalledWith(
        OWNER,
        timestamp,
      );
    });

    it("advances cursor after processing", async () => {
      const deps = makeMockDeps();
      const nextCursor = "2026-01-21T12:00:00Z";
      (
        deps.gateway.listFilesSince as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        files: [makeFileRecord()],
        cursor: nextCursor,
      });

      await downloadAll(deps);

      expect(deps.cursor.write).toHaveBeenCalledWith(nextCursor);
    });

    it("does not advance cursor when nextCursor is null", async () => {
      const deps = makeMockDeps();
      (
        deps.gateway.listFilesSince as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        files: [makeFileRecord()],
        cursor: null,
      });

      await downloadAll(deps);

      expect(deps.cursor.write).not.toHaveBeenCalled();
    });

    it("continues on individual file failure", async () => {
      const deps = makeMockDeps();
      const files = [
        makeFileRecord({ fileId: "file-001" }),
        makeFileRecord({ fileId: "file-002" }),
        makeFileRecord({ fileId: "file-003" }),
      ];
      (
        deps.gateway.listFilesSince as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        files,
        cursor: "2026-01-21T12:00:00Z",
      });

      // Make the second file fail at schema lookup
      let callCount = 0;
      (deps.gateway.getSchema as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          callCount++;
          if (callCount === 2) return Promise.resolve(null);
          return Promise.resolve(makeSchema());
        },
      );

      const results = await downloadAll(deps);

      // First and third succeed, second fails
      expect(results).toHaveLength(2);
      expect(deps.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: "file-002" }),
        "Failed to download file",
      );
      // Cursor still advances despite individual failure
      expect(deps.cursor.write).toHaveBeenCalledWith("2026-01-21T12:00:00Z");
    });
  });
});
