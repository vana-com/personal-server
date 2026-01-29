export interface IndexEntry {
  id: number
  fileId: string | null // null until synced on-chain (Phase 4)
  path: string // relative path from dataDir
  scope: string
  collectedAt: string // ISO 8601
  createdAt: string // ISO 8601
  sizeBytes: number
}

export interface IndexListOptions {
  scope?: string
  limit?: number
  offset?: number
}
