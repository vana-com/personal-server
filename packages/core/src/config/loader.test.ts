import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { access, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadConfig } from "./loader.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "config-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true });
  }
}

describe("loadConfig", () => {
  it("returns defaults when file is missing", async () => {
    const config = await loadConfig({
      configPath: "/tmp/nonexistent-config-path/config.json",
    });

    expect(config.server.port).toBe(8080);
    expect(config.gateway.url).toBe(
      "https://data-gateway-env-dev-opendatalabs.vercel.app",
    );
    expect(config.logging.level).toBe("info");
    expect(config.logging.pretty).toBe(false);
    expect(config.storage.backend).toBe("local");
  });

  it("parses valid config", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          server: { port: 3000 },
          gateway: { url: "https://custom.rpc.org" },
          logging: { level: "debug", pretty: true },
          storage: { backend: "vana" },
        }),
      );

      const config = await loadConfig({ configPath });

      expect(config.server.port).toBe(3000);
      expect(config.gateway.url).toBe("https://custom.rpc.org");
      expect(config.logging.level).toBe("debug");
      expect(config.logging.pretty).toBe(true);
      expect(config.storage.backend).toBe("vana");
    });
  });

  it("merges partial config with defaults", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          server: { port: 9090 },
        }),
      );

      const config = await loadConfig({ configPath });

      expect(config.server.port).toBe(9090);
      // Defaults fill in the rest
      expect(config.gateway.url).toBe(
        "https://data-gateway-env-dev-opendatalabs.vercel.app",
      );
      expect(config.logging.level).toBe("info");
      expect(config.storage.backend).toBe("local");
    });
  });

  it("throws ZodError for invalid config", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          server: { port: -1 },
        }),
      );

      await expect(loadConfig({ configPath })).rejects.toThrow();
    });
  });

  it("throws for malformed JSON", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, "{ invalid json }}}");

      await expect(loadConfig({ configPath })).rejects.toThrow(SyntaxError);
    });
  });

  it("writes defaults to disk when file is missing", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "subdir", "config.json");
      await loadConfig({ configPath });

      // File should now exist with defaults
      await expect(access(configPath)).resolves.toBeUndefined();
      const contents = JSON.parse(await readFile(configPath, "utf-8"));
      expect(contents.server.port).toBe(8080);
      expect(contents.gateway.url).toBe(
        "https://data-gateway-env-dev-opendatalabs.vercel.app",
      );
    });
  });

  it("writes missing defaults back to existing partial file", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ server: { port: 9090 } }));

      await loadConfig({ configPath });

      const onDisk = JSON.parse(await readFile(configPath, "utf-8"));
      // User's value preserved
      expect(onDisk.server.port).toBe(9090);
      // Defaults filled in
      expect(onDisk.gateway.url).toBe(
        "https://data-gateway-env-dev-opendatalabs.vercel.app",
      );
      expect(onDisk.logging.level).toBe("info");
      expect(onDisk.storage.backend).toBe("local");
    });
  });

  it("does not rewrite file when config already has all defaults", async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.json");

      // First load writes defaults
      await loadConfig({ configPath });
      const firstWrite = await readFile(configPath, "utf-8");

      // Second load should not rewrite (content identical)
      await loadConfig({ configPath });
      const secondRead = await readFile(configPath, "utf-8");

      expect(secondRead).toBe(firstWrite);
    });
  });

  it("accepts custom configPath", async () => {
    await withTempDir(async (dir) => {
      const customPath = join(dir, "custom-config.json");
      await writeFile(
        customPath,
        JSON.stringify({
          logging: { level: "warn" },
        }),
      );

      const config = await loadConfig({ configPath: customPath });

      expect(config.logging.level).toBe("warn");
      expect(config.server.port).toBe(8080);
    });
  });
});
