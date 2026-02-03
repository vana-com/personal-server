import type { IndexManager } from "../../storage/index/manager.js";
import type { HierarchyManagerOptions } from "../../storage/hierarchy/index.js";
import type { StorageAdapter } from "../../storage/adapters/interface.js";
import type { GatewayClient } from "../../gateway/client.js";
import type { SyncCursor } from "../cursor.js";
import type { FileRecord } from "../types.js";
import type { Logger } from "pino";
import { writeDataFile } from "../../storage/hierarchy/index.js";
import { deriveScopeKey } from "../../keys/derive.js";
import { decryptWithPassword } from "../../storage/encryption/index.js";
import { DataFileEnvelopeSchema } from "../../schemas/data-file.js";

export interface DownloadWorkerDeps {
  indexManager: IndexManager;
  hierarchyOptions: HierarchyManagerOptions;
  storageAdapter: StorageAdapter;
  gateway: GatewayClient;
  cursor: SyncCursor;
  masterKey: Uint8Array;
  serverOwner: string;
  logger: Logger;
}

export interface DownloadResult {
  fileId: string;
  scope: string;
  collectedAt: string;
  path: string;
}

/**
 * Download and process a single file record from the storage backend:
 * 1. Check dedup: skip if fileId already in local index
 * 2. Download OpenPGP encrypted binary from storage backend
 * 3. Resolve schemaId → scope via Gateway getSchema
 * 4. Derive scope key from master key → hex-encode as OpenPGP password
 * 5. Decrypt with OpenPGP password-based decryption → plaintext JSON
 * 6. Parse as DataFileEnvelope (validate)
 * 7. Write to local filesystem via hierarchy manager
 * 8. Insert into local index (with fileId)
 */
export async function downloadOne(
  deps: DownloadWorkerDeps,
  record: FileRecord,
): Promise<DownloadResult | null> {
  const {
    indexManager,
    hierarchyOptions,
    storageAdapter,
    gateway,
    masterKey,
    logger,
  } = deps;

  // 1. Check dedup: skip if fileId already in local index
  const existing = indexManager.findByFileId(record.fileId);
  if (existing) {
    logger.debug({ fileId: record.fileId }, "File already in index, skipping");
    return null;
  }

  // 2. Download OpenPGP encrypted binary from storage backend
  const encrypted = await storageAdapter.download(record.url);

  // 3. Resolve schemaId → scope via Gateway getSchema
  const schema = await gateway.getSchema(record.schemaId);
  if (!schema) {
    throw new Error(`No schema found for schemaId: ${record.schemaId}`);
  }

  // 4. Derive scope key → hex-encode as OpenPGP password
  const scopeKey = deriveScopeKey(masterKey, schema.scope);
  const scopeKeyHex = Buffer.from(scopeKey).toString("hex");

  // 5. Decrypt with OpenPGP password-based decryption
  const plaintext = await decryptWithPassword(encrypted, scopeKeyHex);

  // 6. Parse as DataFileEnvelope (validate)
  const raw = JSON.parse(new TextDecoder().decode(plaintext));
  const envelope = DataFileEnvelopeSchema.parse(raw);

  // 7. Write to local filesystem via hierarchy manager
  const { relativePath, sizeBytes } = await writeDataFile(
    hierarchyOptions,
    envelope,
  );

  // 8. Insert into local index (with fileId)
  indexManager.insert({
    fileId: record.fileId,
    path: relativePath,
    scope: envelope.scope,
    collectedAt: envelope.collectedAt,
    sizeBytes,
  });

  logger.info(
    { fileId: record.fileId, scope: envelope.scope, path: relativePath },
    "Downloaded and indexed file",
  );

  return {
    fileId: record.fileId,
    scope: envelope.scope,
    collectedAt: envelope.collectedAt,
    path: relativePath,
  };
}

/**
 * Poll Gateway for new file records since lastProcessedTimestamp,
 * download each, and advance the cursor.
 */
export async function downloadAll(
  deps: DownloadWorkerDeps,
): Promise<DownloadResult[]> {
  const { gateway, cursor, serverOwner, logger } = deps;

  // 1. Read cursor
  const lastProcessedTimestamp = await cursor.read();

  // 2. Poll gateway for new file records
  const { files, cursor: nextCursor } = await gateway.listFilesSince(
    serverOwner,
    lastProcessedTimestamp,
  );

  const results: DownloadResult[] = [];

  // 3. Process each file record
  for (const file of files) {
    try {
      const result = await downloadOne(deps, file);
      if (result) {
        results.push(result);
      }
    } catch (err) {
      logger.error(
        {
          fileId: file.fileId,
          schemaId: file.schemaId,
          error: (err as Error).message,
        },
        "Failed to download file",
      );
    }
  }

  // 4. Advance cursor if there are new records
  if (nextCursor !== null) {
    await cursor.write(nextCursor);
  }

  return results;
}
