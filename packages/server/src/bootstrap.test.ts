import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer } from "./bootstrap.js";
import { ServerConfigSchema } from "@personal-server/core/schemas";

function makeDefaultConfig() {
  return ServerConfigSchema.parse({});
}

describe("createServer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "bootstrap-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns object with app, logger, config, startedAt", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    expect(ctx).toHaveProperty("app");
    expect(ctx).toHaveProperty("logger");
    expect(ctx).toHaveProperty("config");
    expect(ctx).toHaveProperty("startedAt");
    ctx.cleanup();
  });

  it("app responds to GET /health", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    const res = await ctx.app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("healthy");
    ctx.cleanup();
  });

  it("logger is a valid pino instance", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    expect(typeof ctx.logger.info).toBe("function");
    expect(typeof ctx.logger.error).toBe("function");
    expect(typeof ctx.logger.warn).toBe("function");
    expect(typeof ctx.logger.debug).toBe("function");
    ctx.cleanup();
  });

  it("startedAt is a reasonable timestamp", async () => {
    const before = new Date();
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });
    const after = new Date();

    expect(ctx.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ctx.startedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    ctx.cleanup();
  });

  it("ServerContext has indexManager property", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    expect(ctx).toHaveProperty("indexManager");
    expect(typeof ctx.indexManager.insert).toBe("function");
    expect(typeof ctx.indexManager.findByPath).toBe("function");
    expect(typeof ctx.indexManager.close).toBe("function");
    ctx.cleanup();
  });

  it("ServerContext has cleanup function", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    expect(typeof ctx.cleanup).toBe("function");
    ctx.cleanup();
  });

  it("POST /v1/data/test.scope returns 400 NO_SCHEMA or 502 GATEWAY_ERROR (schema enforcement)", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    const res = await ctx.app.request("/v1/data/test.scope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    // Schema enforcement: gateway returns no schema (400) or gateway unreachable (502)
    expect([400, 502]).toContain(res.status);

    const body = await res.json();
    expect(["NO_SCHEMA", "GATEWAY_ERROR"]).toContain(body.error);
    ctx.cleanup();
  });

  it("cleanup() can be called without error", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    expect(() => ctx.cleanup()).not.toThrow();
  });

  it("ServerContext has gatewayClient property", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    expect(ctx).toHaveProperty("gatewayClient");
    expect(typeof ctx.gatewayClient.isRegisteredBuilder).toBe("function");
    expect(typeof ctx.gatewayClient.getGrant).toBe("function");
    ctx.cleanup();
  });

  it("GET /v1/data returns 401 (auth middleware wired)", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    const res = await ctx.app.request("/v1/data");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.errorCode).toBe("MISSING_AUTH");
    ctx.cleanup();
  });

  it("GET /v1/data/instagram.profile returns 401 (auth middleware wired)", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    const res = await ctx.app.request("/v1/data/instagram.profile");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.errorCode).toBe("MISSING_AUTH");
    ctx.cleanup();
  });

  it("GET /v1/data/instagram.profile/versions returns 401 (auth middleware wired)", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    const res = await ctx.app.request("/v1/data/instagram.profile/versions");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.errorCode).toBe("MISSING_AUTH");
    ctx.cleanup();
  });

  it("POST /v1/data/:scope does not require auth (schema enforcement may reject)", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    const res = await ctx.app.request("/v1/data/test.scope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "value" }),
    });
    // No auth required: does NOT return 401. Returns 400 (NO_SCHEMA) or 502 (gateway error).
    expect(res.status).not.toBe(401);
    expect([400, 502]).toContain(res.status);
    ctx.cleanup();
  });

  it("config schema accepts server.origin", () => {
    const config = ServerConfigSchema.parse({
      server: { origin: "https://my-server.example.com" },
    });
    expect(config.server.origin).toBe("https://my-server.example.com");
  });

  it("ServerContext has accessLogReader property", async () => {
    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    expect(ctx).toHaveProperty("accessLogReader");
    expect(typeof ctx.accessLogReader.read).toBe("function");
    ctx.cleanup();
  });

  it("derives correct owner when VANA_MASTER_KEY_SIGNATURE is set", async () => {
    const knownSig =
      "0xedbb7743cce459345238442dcfb291f234a321d253485eaa58251aa0f28ea8f1410ab988bae2657b689cd24417b41e315efc22ba333024f4a6269c424ded8d361b";
    vi.stubEnv("VANA_MASTER_KEY_SIGNATURE", knownSig);

    const config = makeDefaultConfig();
    const ctx = await createServer(config, {
      serverDir: tempDir,
      dataDir: join(tempDir, "data"),
    });

    // /health exposes the owner address
    const res = await ctx.app.request("/health");
    const body = await res.json();
    expect(body.owner?.toLowerCase()).toBe(
      "0x2ac93684679a5bda03c6160def908cdb8d46792f",
    );

    ctx.cleanup();
    vi.unstubAllEnvs();
  });

  describe("identity setup", () => {
    const knownSig =
      "0xedbb7743cce459345238442dcfb291f234a321d253485eaa58251aa0f28ea8f1410ab988bae2657b689cd24417b41e315efc22ba333024f4a6269c424ded8d361b";

    const testGatewayConfig = {
      chainId: 14800,
      contracts: {
        dataRegistry: "0x1111111111111111111111111111111111111111",
        dataPortabilityPermissions:
          "0x2222222222222222222222222222222222222222",
        dataPortabilityServer: "0x3333333333333333333333333333333333333333",
      },
    };

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("serverAccount and serverSigner are created when master key is set", async () => {
      vi.stubEnv("VANA_MASTER_KEY_SIGNATURE", knownSig);

      const config = makeDefaultConfig();
      const ctx = await createServer(config, {
        serverDir: tempDir,
        dataDir: join(tempDir, "data"),
      });

      expect(ctx.serverAccount).toBeDefined();
      expect(ctx.serverAccount!.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(ctx.serverAccount!.publicKey).toMatch(/^0x04/);
      expect(ctx.serverSigner).toBeDefined();

      ctx.cleanup();
    });

    it("serverAccount is undefined when master key is not set", async () => {
      const config = ServerConfigSchema.parse({
        gateway: {
          ...testGatewayConfig,
        },
      });
      const ctx = await createServer(config, {
        serverDir: tempDir,
        dataDir: join(tempDir, "data"),
      });

      expect(ctx.serverAccount).toBeUndefined();
      expect(ctx.serverSigner).toBeUndefined();

      ctx.cleanup();
    });

    it("health endpoint exposes identity info with just master key", async () => {
      vi.stubEnv("VANA_MASTER_KEY_SIGNATURE", knownSig);

      const config = makeDefaultConfig();
      const ctx = await createServer(config, {
        serverDir: tempDir,
        dataDir: join(tempDir, "data"),
      });

      const res = await ctx.app.request("/health");
      const body = await res.json();

      expect(body.identity).not.toBeNull();
      expect(body.identity.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(body.identity.publicKey).toMatch(/^0x04/);
      // Gateway unreachable in tests, so serverId should be null
      expect(body.identity.serverId).toBeNull();

      ctx.cleanup();
    });

    it("health endpoint has identity: null without master key", async () => {
      const config = makeDefaultConfig();
      const ctx = await createServer(config, {
        serverDir: tempDir,
        dataDir: join(tempDir, "data"),
      });

      const res = await ctx.app.request("/health");
      const body = await res.json();

      expect(body.identity).toBeNull();

      ctx.cleanup();
    });
  });
});
