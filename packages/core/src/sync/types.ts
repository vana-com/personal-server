/** On-chain file record returned by Gateway DP RPC */
export interface FileRecord {
  fileId: string;
  owner: string;
  url: string; // e.g. "https://storage.vana.com/v1/blobs/{ownerAddress}/{scope}/{collectedAt}"
  schemaId: string;
  createdAt: string; // ISO 8601
}

/** Result from Gateway listFilesSince */
export interface FileListResult {
  files: FileRecord[];
  cursor: string | null; // next lastProcessedTimestamp, null if caught up
}

/** Parameters for registering a file on-chain via Gateway */
export interface RegisterFileParams {
  url: string;
  schemaId: string;
  owner: string;
}

/** Response from Gateway registerFile */
export interface FileRegistration {
  fileId: string;
  status: "pending" | "confirmed";
}

/** Sync engine status for GET /v1/sync/status */
export interface SyncStatus {
  enabled: boolean;
  running: boolean;
  lastSync: string | null; // ISO 8601
  lastProcessedTimestamp: string | null;
  pendingFiles: number;
  errors: SyncError[];
}

export interface SyncError {
  fileId: string | null;
  scope: string | null;
  message: string;
  timestamp: string;
}
