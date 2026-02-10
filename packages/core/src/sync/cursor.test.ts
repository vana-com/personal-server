import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createSyncCursor } from "./cursor.js";
import { loadConfig, saveConfig } from "../config/index.js";
import { ServerConfigSchema } from "../schemas/server-config.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sync-cursor-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true });
  }
}

describe("SyncCursor", () => {
  it("read returns null when config has default sync", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");
      // Create a default config file
      const config = ServerConfigSchema.parse({});
      await saveConfig(config, { configPath });

      const cursor = createSyncCursor(configPath);
      const result = await cursor.read();

      expect(result).toBeNull();
    });
  });

  it("write then read returns the same timestamp", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");
      const config = ServerConfigSchema.parse({});
      await saveConfig(config, { configPath });

      const cursor = createSyncCursor(configPath);
      await cursor.write("2026-01-21T10:00:00Z");

      const result = await cursor.read();
      expect(result).toBe("2026-01-21T10:00:00Z");
    });
  });

  it("write preserves other config fields", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");
      const config = ServerConfigSchema.parse({
        server: { port: 9090 },
        logging: { level: "debug" },
        sync: { enabled: true },
      });
      await saveConfig(config, { configPath });

      const cursor = createSyncCursor(configPath);
      await cursor.write("2026-01-21T10:00:00Z");

      const reloaded = await loadConfig({ configPath });
      expect(reloaded.server.port).toBe(9090);
      expect(reloaded.logging.level).toBe("debug");
      expect(reloaded.sync.enabled).toBe(true);
      expect(reloaded.sync.lastProcessedTimestamp).toBe("2026-01-21T10:00:00Z");
    });
  });

  it("write creates config file if it doesn't exist", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "nonexistent", "config.json");

      const cursor = createSyncCursor(configPath);
      await cursor.write("2026-01-21T10:00:00Z");

      const result = await cursor.read();
      expect(result).toBe("2026-01-21T10:00:00Z");
    });
  });
});
