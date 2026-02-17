import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ServerConfigSchema } from "./server-config.js";
import { loadConfig, saveConfig } from "../config/loader.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "server-config-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true });
  }
}

describe("ServerConfigSchema — sync fields", () => {
  it("default config has sync.enabled: false and sync.lastProcessedTimestamp: null", () => {
    const config = ServerConfigSchema.parse({});

    expect(config.sync.enabled).toBe(false);
    expect(config.sync.lastProcessedTimestamp).toBeNull();
  });

  it("sync.enabled: true parses correctly", () => {
    const config = ServerConfigSchema.parse({
      sync: { enabled: true },
    });

    expect(config.sync.enabled).toBe(true);
    expect(config.sync.lastProcessedTimestamp).toBeNull();
  });

  it("sync.lastProcessedTimestamp with valid ISO 8601 parses correctly", () => {
    const config = ServerConfigSchema.parse({
      sync: { lastProcessedTimestamp: "2026-01-21T10:00:00Z" },
    });

    expect(config.sync.lastProcessedTimestamp).toBe("2026-01-21T10:00:00Z");
  });

  it("server.address is optional and accepts 0x-prefixed strings", () => {
    const config = ServerConfigSchema.parse({
      server: { address: "0x1234567890abcdef1234567890abcdef12345678" },
    });
    expect(config.server.address).toBe(
      "0x1234567890abcdef1234567890abcdef12345678",
    );
  });

  it("server.address defaults to undefined when not provided", () => {
    const config = ServerConfigSchema.parse({});
    expect(config.server.address).toBeUndefined();
  });

  it("storage.config.vana.apiUrl defaults to https://storage.vana.com", () => {
    const config = ServerConfigSchema.parse({
      storage: { config: { vana: {} } },
    });

    expect(config.storage.config.vana?.apiUrl).toBe("https://storage.vana.com");
  });
});

describe("saveConfig", () => {
  it("writes JSON file that loadConfig reads back identically", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");

      // Load default config (creates file)
      const original = await loadConfig({ configPath });

      // Modify sync fields
      original.sync.enabled = true;
      original.sync.lastProcessedTimestamp = "2026-01-21T10:00:00Z";

      // Save modified config
      await saveConfig(original, { configPath });

      // Load it back
      const reloaded = await loadConfig({ configPath });

      expect(reloaded.sync.enabled).toBe(true);
      expect(reloaded.sync.lastProcessedTimestamp).toBe("2026-01-21T10:00:00Z");
      expect(reloaded.server.port).toBe(original.server.port);
      expect(reloaded.logging.level).toBe(original.logging.level);
    });
  });

  it("creates parent directory if missing", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "nested", "deep", "config.json");

      const config = ServerConfigSchema.parse({});
      await saveConfig(config, { configPath });

      const raw = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.server.port).toBe(8080);
      expect(parsed.sync.enabled).toBe(false);
    });
  });
});
