import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeDatabase } from "./schema.js";

describe("initializeDatabase", () => {
  it("returns a Database instance", () => {
    const db = initializeDatabase(":memory:");
    expect(db).toBeDefined();
    expect(typeof db.close).toBe("function");
    db.close();
  });

  it("creates data_files table", () => {
    const db = initializeDatabase(":memory:");
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='data_files'",
      )
      .get() as { name: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.name).toBe("data_files");
    db.close();
  });

  it("has all expected columns", () => {
    const db = initializeDatabase(":memory:");
    const columns = db.prepare("PRAGMA table_info(data_files)").all() as {
      name: string;
    }[];
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("file_id");
    expect(columnNames).toContain("path");
    expect(columnNames).toContain("scope");
    expect(columnNames).toContain("collected_at");
    expect(columnNames).toContain("created_at");
    expect(columnNames).toContain("size_bytes");
    db.close();
  });

  it("sets WAL journal mode", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "schema-wal-"));
    const dbPath = join(tempDir, "wal-test.db");
    const db = initializeDatabase(dbPath);
    const result = db.pragma("journal_mode") as { journal_mode: string }[];
    expect(result[0]!.journal_mode).toBe("wal");
    db.close();
    await rm(tempDir, { recursive: true });
  });

  it("is idempotent when called twice on same path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "schema-test-"));
    const dbPath = join(tempDir, "test.db");

    const db1 = initializeDatabase(dbPath);
    db1.close();

    const db2 = initializeDatabase(dbPath);
    const row = db2
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='data_files'",
      )
      .get() as { name: string } | undefined;
    expect(row).toBeDefined();
    db2.close();

    await rm(tempDir, { recursive: true });
  });
});
