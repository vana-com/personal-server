import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { uiConfigRoutes } from "./ui-config.js";

const DEV_TOKEN = "test-dev-token-123";

describe("uiConfigRoutes", () => {
  let configPath: string;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `ui-config-test-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
    configPath = join(tmpDir, "config.json");
  });

  afterEach(async () => {
    try {
      await unlink(configPath);
    } catch {
      // ignore
    }
  });

  function createApp() {
    return uiConfigRoutes({ devToken: DEV_TOKEN, configPath });
  }

  describe("GET /config", () => {
    it("returns config when file exists", async () => {
      const config = { server: { port: 9090 } };
      await writeFile(configPath, JSON.stringify(config));

      const app = createApp();
      const res = await app.request("/config", {
        headers: { Authorization: `Bearer ${DEV_TOKEN}` },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.server.port).toBe(9090);
    });

    it("returns 404 when file does not exist", async () => {
      const app = createApp();
      const res = await app.request("/config", {
        headers: { Authorization: `Bearer ${DEV_TOKEN}` },
      });

      expect(res.status).toBe(404);
    });

    it("returns 401 without dev token", async () => {
      const app = createApp();
      const res = await app.request("/config");

      expect(res.status).toBe(401);
    });

    it("returns 401 with wrong dev token", async () => {
      const app = createApp();
      const res = await app.request("/config", {
        headers: { Authorization: "Bearer wrong-token" },
      });

      expect(res.status).toBe(401);
    });
  });

  describe("PUT /config", () => {
    it("validates and writes config", async () => {
      const app = createApp();
      const newConfig = {
        server: { port: 3000 },
        gateway: { url: "https://rpc.vana.org" },
      };

      const res = await app.request("/config", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${DEV_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newConfig),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("saved");
      expect(json.config.server.port).toBe(3000);
    });

    it("rejects invalid config", async () => {
      const app = createApp();
      const invalid = { server: { port: -1 } };

      const res = await app.request("/config", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${DEV_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invalid),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.errorCode).toBe("VALIDATION_ERROR");
    });

    it("returns 401 without dev token", async () => {
      const app = createApp();

      const res = await app.request("/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: { port: 3000 } }),
      });

      expect(res.status).toBe(401);
    });
  });
});
