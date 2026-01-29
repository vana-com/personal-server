import Database from 'better-sqlite3'

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS data_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT,
  path TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  size_bytes INTEGER NOT NULL DEFAULT 0
)`

const CREATE_INDEXES_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_data_files_scope ON data_files (scope)',
  'CREATE INDEX IF NOT EXISTS idx_data_files_collected_at ON data_files (collected_at)',
  'CREATE INDEX IF NOT EXISTS idx_data_files_file_id ON data_files (file_id)',
]

/** Open/create SQLite database, run CREATE TABLE IF NOT EXISTS, set WAL mode */
export function initializeDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')

  db.exec(CREATE_TABLE_SQL)
  for (const sql of CREATE_INDEXES_SQL) {
    db.exec(sql)
  }

  return db
}
