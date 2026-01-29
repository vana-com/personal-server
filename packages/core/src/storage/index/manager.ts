import type Database from 'better-sqlite3'
import type { IndexEntry, IndexListOptions } from './types.js'

export interface IndexManager {
  insert(entry: Omit<IndexEntry, 'id' | 'createdAt'>): IndexEntry
  findByPath(path: string): IndexEntry | undefined
  findByScope(options: IndexListOptions): IndexEntry[]
  findLatestByScope(scope: string): IndexEntry | undefined
  countByScope(scope: string): number
  deleteByPath(path: string): boolean
  close(): void
}

interface RawRow {
  id: number
  file_id: string | null
  path: string
  scope: string
  collected_at: string
  created_at: string
  size_bytes: number
}

function rowToEntry(row: RawRow): IndexEntry {
  return {
    id: row.id,
    fileId: row.file_id,
    path: row.path,
    scope: row.scope,
    collectedAt: row.collected_at,
    createdAt: row.created_at,
    sizeBytes: row.size_bytes,
  }
}

export function createIndexManager(db: Database.Database): IndexManager {
  const insertStmt = db.prepare<{
    file_id: string | null
    path: string
    scope: string
    collected_at: string
    size_bytes: number
  }>(
    `INSERT INTO data_files (file_id, path, scope, collected_at, size_bytes)
     VALUES (@file_id, @path, @scope, @collected_at, @size_bytes)`,
  )

  const findByPathStmt = db.prepare<{ path: string }>(
    'SELECT * FROM data_files WHERE path = @path',
  )

  const findLatestByScopeStmt = db.prepare<{ scope: string }>(
    'SELECT * FROM data_files WHERE scope = @scope ORDER BY collected_at DESC LIMIT 1',
  )

  const countByScopeStmt = db.prepare<{ scope: string }>(
    'SELECT COUNT(*) AS cnt FROM data_files WHERE scope = @scope',
  )

  const deleteByPathStmt = db.prepare<{ path: string }>(
    'DELETE FROM data_files WHERE path = @path',
  )

  return {
    insert(entry) {
      const result = insertStmt.run({
        file_id: entry.fileId,
        path: entry.path,
        scope: entry.scope,
        collected_at: entry.collectedAt,
        size_bytes: entry.sizeBytes,
      })
      const row = db
        .prepare('SELECT * FROM data_files WHERE id = ?')
        .get(result.lastInsertRowid) as RawRow
      return rowToEntry(row)
    },

    findByPath(path) {
      const row = findByPathStmt.get({ path }) as RawRow | undefined
      return row ? rowToEntry(row) : undefined
    },

    findByScope(options) {
      let sql = 'SELECT * FROM data_files'
      const params: Record<string, unknown> = {}

      if (options.scope) {
        sql += ' WHERE scope = @scope'
        params.scope = options.scope
      }

      sql += ' ORDER BY collected_at DESC'

      if (options.limit !== undefined) {
        sql += ' LIMIT @limit'
        params.limit = options.limit
      }

      if (options.offset !== undefined) {
        sql += ' OFFSET @offset'
        params.offset = options.offset
      }

      const rows = db.prepare(sql).all(params) as RawRow[]
      return rows.map(rowToEntry)
    },

    findLatestByScope(scope) {
      const row = findLatestByScopeStmt.get({ scope }) as RawRow | undefined
      return row ? rowToEntry(row) : undefined
    },

    countByScope(scope) {
      const row = countByScopeStmt.get({ scope }) as { cnt: number }
      return row.cnt
    },

    deleteByPath(path) {
      const result = deleteByPathStmt.run({ path })
      return result.changes > 0
    },

    close() {
      db.close()
    },
  }
}
