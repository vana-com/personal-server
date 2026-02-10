import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  mkdir,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FRPC_VERSION,
  getPlatformInfo,
  getBinaryPath,
  getInstalledVersion,
  writeVersionFile,
  getDownloadUrl,
  ensureFrpcBinary,
} from "./binary.js";

describe("tunnel/binary", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "frpc-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("FRPC_VERSION", () => {
    it("is a valid semver string", () => {
      expect(FRPC_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("getPlatformInfo", () => {
    it("returns platform info for the current platform", () => {
      const info = getPlatformInfo();
      expect(info).toHaveProperty("name");
      expect(info).toHaveProperty("ext");
      expect(info).toHaveProperty("binaryName");
      expect(["tar.gz", "zip"]).toContain(info.ext);
    });

    it("returns correct binary name based on platform", () => {
      const info = getPlatformInfo();
      if (process.platform === "win32") {
        expect(info.binaryName).toBe("frpc.exe");
        expect(info.ext).toBe("zip");
      } else {
        expect(info.binaryName).toBe("frpc");
        expect(info.ext).toBe("tar.gz");
      }
    });

    it("includes architecture in name", () => {
      const info = getPlatformInfo();
      expect(info.name).toMatch(/(amd64|arm64)/);
    });
  });

  describe("getBinaryPath", () => {
    it("returns path under storageRoot/bin", () => {
      const path = getBinaryPath("/home/user/personal-server");
      expect(path).toContain(
        join("bin", process.platform === "win32" ? "frpc.exe" : "frpc"),
      );
    });

    it("uses .exe extension on win32", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });
      try {
        const path = getBinaryPath("/test");
        expect(path).toMatch(/frpc\.exe$/);
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
      }
    });
  });

  describe("getDownloadUrl", () => {
    it("builds correct GitHub release URL", () => {
      const url = getDownloadUrl("0.67.0", {
        name: "darwin_arm64",
        ext: "tar.gz",
        binaryName: "frpc",
      });
      expect(url).toBe(
        "https://github.com/fatedier/frp/releases/download/v0.67.0/frp_0.67.0_darwin_arm64.tar.gz",
      );
    });

    it("builds correct URL for windows", () => {
      const url = getDownloadUrl("0.67.0", {
        name: "windows_amd64",
        ext: "zip",
        binaryName: "frpc.exe",
      });
      expect(url).toBe(
        "https://github.com/fatedier/frp/releases/download/v0.67.0/frp_0.67.0_windows_amd64.zip",
      );
    });
  });

  describe("version file", () => {
    it("returns null when version file does not exist", async () => {
      const version = await getInstalledVersion(tempDir);
      expect(version).toBeNull();
    });

    it("returns null when version file is corrupted JSON", async () => {
      await mkdir(join(tempDir, "bin"), { recursive: true });
      await writeFile(join(tempDir, "bin", "frpc-version.json"), "not json{{{");
      const version = await getInstalledVersion(tempDir);
      expect(version).toBeNull();
    });

    it("reads version from valid metadata file", async () => {
      await mkdir(join(tempDir, "bin"), { recursive: true });
      await writeFile(
        join(tempDir, "bin", "frpc-version.json"),
        JSON.stringify({
          version: "0.67.0",
          platform: "darwin_arm64",
          installedAt: "2025-01-01T00:00:00.000Z",
        }),
      );
      const version = await getInstalledVersion(tempDir);
      expect(version).toBe("0.67.0");
    });

    it("writes and reads back version metadata", async () => {
      await mkdir(join(tempDir, "bin"), { recursive: true });
      await writeVersionFile(tempDir, "0.67.0");

      const raw = JSON.parse(
        await readFile(join(tempDir, "bin", "frpc-version.json"), "utf-8"),
      );
      expect(raw.version).toBe("0.67.0");
      expect(raw.platform).toMatch(/^(darwin|linux|win32)_/);
      expect(raw.installedAt).toBeTruthy();
    });
  });

  describe("ensureFrpcBinary", () => {
    it("skips download when version matches and binary exists", async () => {
      // Set up a fake existing binary + version file
      const binDir = join(tempDir, "bin");
      await mkdir(binDir, { recursive: true });

      const binaryPath = getBinaryPath(tempDir);
      await writeFile(binaryPath, "fake-binary");
      await writeVersionFile(tempDir, FRPC_VERSION);

      const logs: string[] = [];
      const result = await ensureFrpcBinary(tempDir, {
        log: (msg) => logs.push(msg),
      });

      expect(result).toBe(binaryPath);
      expect(logs.some((l) => l.includes("already installed"))).toBe(true);
    });

    it("attempts download when version file is missing", async () => {
      // No version file, no binary — ensureFrpcBinary should try to download
      // Mock fetch to avoid real network calls
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("network disabled in test"));

      try {
        await expect(
          ensureFrpcBinary(tempDir, { log: () => {} }),
        ).rejects.toThrow("network disabled in test");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("attempts download when installed version does not match", async () => {
      const binDir = join(tempDir, "bin");
      await mkdir(binDir, { recursive: true });

      const binaryPath = getBinaryPath(tempDir);
      await writeFile(binaryPath, "fake-binary");
      // Write an old version
      await writeFile(
        join(binDir, "frpc-version.json"),
        JSON.stringify({
          version: "0.60.0",
          platform: "test",
          installedAt: "2025-01-01",
        }),
      );

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("network disabled in test"));

      try {
        await expect(
          ensureFrpcBinary(tempDir, { log: () => {} }),
        ).rejects.toThrow("network disabled in test");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("attempts download when binary is missing despite valid version file", async () => {
      const binDir = join(tempDir, "bin");
      await mkdir(binDir, { recursive: true });
      await writeVersionFile(tempDir, FRPC_VERSION);
      // Do NOT create the binary file

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("network disabled in test"));

      try {
        await expect(
          ensureFrpcBinary(tempDir, { log: () => {} }),
        ).rejects.toThrow("network disabled in test");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("cleans up temp archive on failure", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("download failed"));

      try {
        await ensureFrpcBinary(tempDir, { log: () => {} }).catch(() => {});
      } finally {
        globalThis.fetch = originalFetch;
      }

      // Verify no temp archive files remain
      const binDir = join(tempDir, "bin");
      await expect(
        access(join(binDir, "_frpc_download.tar.gz")),
      ).rejects.toThrow();
    });

    it("provides clear error on HTTP failure", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        body: null,
      } as Response);

      try {
        await expect(
          ensureFrpcBinary(tempDir, { log: () => {} }),
        ).rejects.toThrow(/Failed to download frpc: HTTP 404/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
