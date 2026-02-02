import type { IndexManager } from "../../storage/index/manager.js";
import type { HierarchyManagerOptions } from "../../storage/hierarchy/index.js";
import type { StorageAdapter } from "../../storage/adapters/interface.js";
import type { GatewayClient } from "../../gateway/client.js";
import type { ServerSigner } from "../../signing/signer.js";
import type { Logger } from "pino";
import type { IndexEntry } from "../../storage/index/types.js";
import { readDataFile } from "../../storage/hierarchy/index.js";
import { deriveScopeKey } from "../../keys/derive.js";
import { encryptWithPassword } from "../../storage/encryption/index.js";

export interface UploadWorkerDeps {
  indexManager: IndexManager;
  hierarchyOptions: HierarchyManagerOptions;
  storageAdapter: StorageAdapter;
  gateway: GatewayClient;
  signer: ServerSigner;
  masterKey: Uint8Array;
  serverOwner: string;
  logger: Logger;
}

export interface UploadResult {
  path: string;
  fileId: string;
  url: string;
}

/**
 * Upload a single unsynced index entry:
 * 1. Read local data file from disk
 * 2. Look up schema for the scope → get schemaId
 * 3. Derive scope key from master key → hex-encode as OpenPGP password
 * 4. Encrypt with OpenPGP password-based encryption → binary
 * 5. Upload OpenPGP binary to storage backend
 * 6. Sign file registration via EIP-712
 * 7. Register file record on-chain via Gateway (with schemaId)
 * 8. Update local index with fileId
 */
export async function uploadOne(
  deps: UploadWorkerDeps,
  entry: IndexEntry,
): Promise<UploadResult> {
  const {
    indexManager,
    hierarchyOptions,
    storageAdapter,
    gateway,
    signer,
    masterKey,
    serverOwner,
    logger,
  } = deps;

  // 1. Read local data file
  const envelope = await readDataFile(
    hierarchyOptions,
    entry.scope,
    entry.collectedAt,
  );

  // 2. Look up schema for the scope
  const schema = await gateway.getSchemaForScope(entry.scope);
  if (!schema) {
    throw new Error(`No schema found for scope: ${entry.scope}`);
  }

  // 3. Derive scope key → hex-encode as OpenPGP password
  const scopeKey = deriveScopeKey(masterKey, entry.scope);
  const scopeKeyHex = Buffer.from(scopeKey).toString("hex");

  // 4. Encrypt with OpenPGP password-based encryption
  const plaintext = new TextEncoder().encode(JSON.stringify(envelope));
  const encrypted = await encryptWithPassword(plaintext, scopeKeyHex);

  // 5. Upload to storage backend
  const storageKey = `${entry.scope}/${entry.collectedAt}`;
  const url = await storageAdapter.upload(storageKey, encrypted);

  // 6. Sign file registration via EIP-712
  const signature = await signer.signFileRegistration({
    ownerAddress: serverOwner as `0x${string}`,
    url,
    schemaId: schema.id as `0x${string}`,
  });

  // 7. Register file on-chain via Gateway
  const registration = await gateway.registerFile({
    ownerAddress: serverOwner,
    url,
    schemaId: schema.id,
    signature,
  });

  const fileId = registration.fileId;
  if (!fileId) {
    throw new Error(
      `Gateway registerFile did not return a fileId for ${entry.path}`,
    );
  }

  // 8. Update local index with fileId
  indexManager.updateFileId(entry.path, fileId);

  logger.info(
    { path: entry.path, fileId, url },
    "Uploaded and registered file",
  );

  return { path: entry.path, fileId, url };
}

/**
 * Process all unsynced entries (fileId === null).
 * Processes sequentially to avoid overwhelming storage backend.
 * Returns array of results (skips failures, logs errors).
 */
export async function uploadAll(
  deps: UploadWorkerDeps,
  options?: { batchSize?: number },
): Promise<UploadResult[]> {
  const batchSize = options?.batchSize ?? 50;
  const entries = deps.indexManager.findUnsynced({ limit: batchSize });
  const results: UploadResult[] = [];

  for (const entry of entries) {
    try {
      const result = await uploadOne(deps, entry);
      results.push(result);
    } catch (err) {
      deps.logger.error(
        { path: entry.path, scope: entry.scope, error: (err as Error).message },
        "Failed to upload entry",
      );
    }
  }

  return results;
}
