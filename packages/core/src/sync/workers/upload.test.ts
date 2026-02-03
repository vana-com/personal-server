import { describe, it, expect, vi, beforeEach } from "vitest";

import type { UploadWorkerDeps } from "./upload.js";
import { uploadOne, uploadAll } from "./upload.js";
import type { IndexEntry } from "../../storage/index/types.js";
import type { IndexManager } from "../../storage/index/manager.js";
import type { StorageAdapter } from "../../storage/adapters/interface.js";
import type { GatewayClient, Schema } from "../../gateway/client.js";
import type { ServerSigner } from "../../signing/signer.js";
import type { HierarchyManagerOptions } from "../../storage/hierarchy/index.js";
import type { DataFileEnvelope } from "../../schemas/data-file.js";
import type { Logger } from "pino";

// Mock the filesystem-dependent modules
vi.mock("../../storage/hierarchy/index.js", () => ({
  readDataFile: vi.fn(),
}));

vi.mock("../../keys/derive.js", () => ({
  deriveScopeKey: vi.fn(),
}));

vi.mock("../../storage/encryption/index.js", () => ({
  encryptWithPassword: vi.fn(),
}));

import { readDataFile } from "../../storage/hierarchy/index.js";
import { deriveScopeKey } from "../../keys/derive.js";
import { encryptWithPassword } from "../../storage/encryption/index.js";

const SCOPE = "instagram.profile";
const COLLECTED_AT = "2026-01-21T10:00:00Z";
const OWNER = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";
const SCHEMA_ID =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const FILE_ID = "file-001";
const STORAGE_URL = `https://storage.vana.com/v1/blobs/${OWNER}/${SCOPE}/${COLLECTED_AT}`;

function makeEntry(overrides?: Partial<IndexEntry>): IndexEntry {
  return {
    id: 1,
    fileId: null,
    path: `${SCOPE}/${COLLECTED_AT}.json`,
    scope: SCOPE,
    collectedAt: COLLECTED_AT,
    createdAt: "2026-01-21T10:00:00Z",
    sizeBytes: 256,
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

function makeMockDeps(): UploadWorkerDeps {
  const mockIndexManager: Partial<IndexManager> = {
    findUnsynced: vi.fn().mockReturnValue([]),
    updateFileId: vi.fn().mockReturnValue(true),
  };

  const mockStorageAdapter: Partial<StorageAdapter> = {
    upload: vi.fn().mockResolvedValue(STORAGE_URL),
  };

  const mockGateway: Partial<GatewayClient> = {
    getSchemaForScope: vi.fn().mockResolvedValue(makeSchema()),
    registerFile: vi.fn().mockResolvedValue({ fileId: FILE_ID }),
  };

  const mockSigner: Partial<ServerSigner> = {
    signFileRegistration: vi
      .fn()
      .mockResolvedValue("0xmocksignature" as `0x${string}`),
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
    signer: mockSigner as ServerSigner,
    masterKey: new Uint8Array(65).fill(0xaa),
    serverOwner: OWNER,
    logger: mockLogger as Logger,
  };
}

describe("upload worker", () => {
  const SCOPE_KEY = new Uint8Array(32).fill(0xbb);
  const SCOPE_KEY_HEX = Buffer.from(SCOPE_KEY).toString("hex");
  const ENCRYPTED_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

  beforeEach(() => {
    vi.clearAllMocks();

    (readDataFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEnvelope(),
    );
    (deriveScopeKey as ReturnType<typeof vi.fn>).mockReturnValue(SCOPE_KEY);
    (encryptWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue(
      ENCRYPTED_BYTES,
    );
  });

  describe("uploadOne", () => {
    it("calls encryptWithPassword with correct scope key hex", async () => {
      const deps = makeMockDeps();
      const entry = makeEntry();

      await uploadOne(deps, entry);

      expect(deriveScopeKey).toHaveBeenCalledWith(deps.masterKey, SCOPE);
      expect(encryptWithPassword).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        SCOPE_KEY_HEX,
      );

      // Verify the plaintext passed to encrypt is the JSON of the envelope
      const plaintextArg = (encryptWithPassword as ReturnType<typeof vi.fn>)
        .mock.calls[0][0] as Uint8Array;
      const decoded = new TextDecoder().decode(plaintextArg);
      expect(JSON.parse(decoded)).toEqual(makeEnvelope());
    });

    it("calls storage adapter upload with encrypted binary", async () => {
      const deps = makeMockDeps();
      const entry = makeEntry();

      await uploadOne(deps, entry);

      expect(deps.storageAdapter.upload).toHaveBeenCalledWith(
        `${SCOPE}/${COLLECTED_AT}`,
        ENCRYPTED_BYTES,
      );
    });

    it("calls gateway registerFile with correct schemaId and signature", async () => {
      const deps = makeMockDeps();
      const entry = makeEntry();

      await uploadOne(deps, entry);

      expect(deps.signer.signFileRegistration).toHaveBeenCalledWith({
        ownerAddress: OWNER,
        url: STORAGE_URL,
        schemaId: SCHEMA_ID,
      });

      expect(deps.gateway.registerFile).toHaveBeenCalledWith({
        ownerAddress: OWNER,
        url: STORAGE_URL,
        schemaId: SCHEMA_ID,
        signature: "0xmocksignature",
      });
    });

    it("updates index with returned fileId", async () => {
      const deps = makeMockDeps();
      const entry = makeEntry();

      const result = await uploadOne(deps, entry);

      expect(deps.indexManager.updateFileId).toHaveBeenCalledWith(
        entry.path,
        FILE_ID,
      );
      expect(result).toEqual({
        path: entry.path,
        fileId: FILE_ID,
        url: STORAGE_URL,
      });
    });

    it("throws if schema lookup returns null", async () => {
      const deps = makeMockDeps();
      (
        deps.gateway.getSchemaForScope as ReturnType<typeof vi.fn>
      ).mockResolvedValue(null);
      const entry = makeEntry();

      await expect(uploadOne(deps, entry)).rejects.toThrow(
        `No schema found for scope: ${SCOPE}`,
      );
    });
  });

  describe("uploadAll", () => {
    it("processes all unsynced entries", async () => {
      const deps = makeMockDeps();
      const entries = [
        makeEntry({ id: 1, path: "a/1.json" }),
        makeEntry({ id: 2, path: "b/2.json", scope: "chatgpt.conversations" }),
        makeEntry({ id: 3, path: "c/3.json" }),
      ];
      (
        deps.indexManager.findUnsynced as ReturnType<typeof vi.fn>
      ).mockReturnValue(entries);

      const results = await uploadAll(deps);

      expect(deps.indexManager.findUnsynced).toHaveBeenCalledWith({
        limit: 50,
      });
      expect(results).toHaveLength(3);
      expect(deps.storageAdapter.upload).toHaveBeenCalledTimes(3);
    });

    it("continues on individual entry failure (logs error)", async () => {
      const deps = makeMockDeps();
      const entries = [
        makeEntry({ id: 1, path: "a/1.json" }),
        makeEntry({ id: 2, path: "b/2.json" }),
        makeEntry({ id: 3, path: "c/3.json" }),
      ];
      (
        deps.indexManager.findUnsynced as ReturnType<typeof vi.fn>
      ).mockReturnValue(entries);

      // Make the second entry fail at schema lookup
      let callCount = 0;
      (
        deps.gateway.getSchemaForScope as ReturnType<typeof vi.fn>
      ).mockImplementation(() => {
        callCount++;
        if (callCount === 2) return Promise.resolve(null);
        return Promise.resolve(makeSchema());
      });

      const results = await uploadAll(deps);

      expect(results).toHaveLength(2);
      expect(deps.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ path: "b/2.json" }),
        "Failed to upload entry",
      );
    });
  });
});
