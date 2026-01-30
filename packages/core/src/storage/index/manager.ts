import type Database from "better-sqlite3";
import type { IndexEntry, IndexListOptions, ScopeSummary } from "./types.js";

export interface IndexManager {
  insert(entry: Omit<IndexEntry, "id" | "createdAt">): IndexEntry;
  findByPath(path: string): IndexEntry | undefined;
  findByScope(options: IndexListOptions): IndexEntry[];
  findLatestByScope(scope: string): IndexEntry | undefined;
  countByScope(scope: string): number;
  deleteByPath(path: string): boolean;
  listDistinctScopes(options?: {
    scopePrefix?: string;
    limit?: number;
    offset?: number;
  }): { scopes: ScopeSummary[]; total: number };
  findClosestByScope(scope: string, at: string): IndexEntry | undefined;
  findByFileId(fileId: string): IndexEntry | undefined;
  /** Deletes all index entries for a scope. Returns count of deleted rows. */
  deleteByScope(scope: string): number;
  close(): void;
}

interface RawRow {
  id: number;
  file_id: string | null;
  path: string;
  scope: string;
  collected_at: string;
  created_at: string;
  size_bytes: number;
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
  };
}

export function createIndexManager(db: Database.Database): IndexManager {
  const insertStmt = db.prepare<{
    file_id: string | null;
    path: string;
    scope: string;
    collected_at: string;
    size_bytes: number;
  }>(
    `INSERT INTO data_files (file_id, path, scope, collected_at, size_bytes)
     VALUES (@file_id, @path, @scope, @collected_at, @size_bytes)`,
  );

  const findByPathStmt = db.prepare<{ path: string }>(
    "SELECT * FROM data_files WHERE path = @path",
  );

  const findLatestByScopeStmt = db.prepare<{ scope: string }>(
    "SELECT * FROM data_files WHERE scope = @scope ORDER BY collected_at DESC LIMIT 1",
  );

  const countByScopeStmt = db.prepare<{ scope: string }>(
    "SELECT COUNT(*) AS cnt FROM data_files WHERE scope = @scope",
  );

  const deleteByPathStmt = db.prepare<{ path: string }>(
    "DELETE FROM data_files WHERE path = @path",
  );

  const findClosestByScopeStmt = db.prepare<{ scope: string; at: string }>(
    "SELECT * FROM data_files WHERE scope = @scope AND collected_at <= @at ORDER BY collected_at DESC LIMIT 1",
  );

  const findByFileIdStmt = db.prepare<{ file_id: string }>(
    "SELECT * FROM data_files WHERE file_id = @file_id",
  );

  const deleteByScopeStmt = db.prepare<{ scope: string }>(
    "DELETE FROM data_files WHERE scope = @scope",
  );

  return {
    insert(entry) {
      const result = insertStmt.run({
        file_id: entry.fileId,
        path: entry.path,
        scope: entry.scope,
        collected_at: entry.collectedAt,
        size_bytes: entry.sizeBytes,
      });
      const row = db
        .prepare("SELECT * FROM data_files WHERE id = ?")
        .get(result.lastInsertRowid) as RawRow;
      return rowToEntry(row);
    },

    findByPath(path) {
      const row = findByPathStmt.get({ path }) as RawRow | undefined;
      return row ? rowToEntry(row) : undefined;
    },

    findByScope(options) {
      let sql = "SELECT * FROM data_files";
      const params: Record<string, unknown> = {};

      if (options.scope) {
        sql += " WHERE scope = @scope";
        params.scope = options.scope;
      }

      sql += " ORDER BY collected_at DESC";

      if (options.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = options.limit;
      }

      if (options.offset !== undefined) {
        sql += " OFFSET @offset";
        params.offset = options.offset;
      }

      const rows = db.prepare(sql).all(params) as RawRow[];
      return rows.map(rowToEntry);
    },

    findLatestByScope(scope) {
      const row = findLatestByScopeStmt.get({ scope }) as RawRow | undefined;
      return row ? rowToEntry(row) : undefined;
    },

    countByScope(scope) {
      const row = countByScopeStmt.get({ scope }) as { cnt: number };
      return row.cnt;
    },

    deleteByPath(path) {
      const result = deleteByPathStmt.run({ path });
      return result.changes > 0;
    },

    listDistinctScopes(options) {
      const hasPrefix =
        options?.scopePrefix !== undefined && options.scopePrefix !== "";
      const prefix = hasPrefix ? options!.scopePrefix! + "%" : "%";

      const countRow = db
        .prepare(
          "SELECT COUNT(DISTINCT scope) AS cnt FROM data_files WHERE scope LIKE @prefix",
        )
        .get({ prefix }) as { cnt: number };
      const total = countRow.cnt;

      let sql =
        "SELECT scope, MAX(collected_at) AS latest_collected_at, COUNT(*) AS version_count FROM data_files WHERE scope LIKE @prefix GROUP BY scope ORDER BY scope ASC";
      const params: Record<string, unknown> = { prefix };

      if (options?.limit !== undefined) {
        sql += " LIMIT @limit";
        params.limit = options.limit;
      }
      if (options?.offset !== undefined) {
        sql += " OFFSET @offset";
        params.offset = options.offset;
      }

      const rows = db.prepare(sql).all(params) as Array<{
        scope: string;
        latest_collected_at: string;
        version_count: number;
      }>;

      return {
        scopes: rows.map((r) => ({
          scope: r.scope,
          latestCollectedAt: r.latest_collected_at,
          versionCount: r.version_count,
        })),
        total,
      };
    },

    findClosestByScope(scope, at) {
      const row = findClosestByScopeStmt.get({ scope, at }) as
        | RawRow
        | undefined;
      return row ? rowToEntry(row) : undefined;
    },

    findByFileId(fileId) {
      const row = findByFileIdStmt.get({ file_id: fileId }) as
        | RawRow
        | undefined;
      return row ? rowToEntry(row) : undefined;
    },

    deleteByScope(scope) {
      const result = deleteByScopeStmt.run({ scope });
      return result.changes;
    },

    close() {
      db.close();
    },
  };
}
