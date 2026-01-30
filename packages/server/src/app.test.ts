import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "./app.js";
import { MissingAuthError } from "@personal-server/core/errors";
import {
  initializeDatabase,
  createIndexManager,
  type IndexManager,
} from "@personal-server/core/storage/index";
import type { GatewayClient } from "@personal-server/core/gateway";
import type { AccessLogWriter } from "@personal-server/core/logging/access-log";
import type { AccessLogReader } from "@personal-server/core/logging/access-reader";
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from "@personal-server/core/test-utils";
import pino from "pino";

const SERVER_ORIGIN = "http://localhost:8080";
const ownerWallet = createTestWallet(0);
const nonOwnerWallet = createTestWallet(1);

function createMockGateway(): GatewayClient {
  return {
    isRegisteredBuilder: vi.fn().mockResolvedValue(true),
    getBuilder: vi.fn().mockResolvedValue(null),
    getGrant: vi.fn().mockResolvedValue(null),
    listGrantsByUser: vi.fn().mockResolvedValue([]),
    getSchemaForScope: vi.fn().mockResolvedValue({
      id: "0xschema1",
      ownerAddress: "0xOwner",
      name: "test.scope",
      definitionUrl: "https://ipfs.io/ipfs/QmTestSchema",
      scope: "test.scope",
      addedAt: "2026-01-21T10:00:00.000Z",
    }),
    getServer: vi.fn().mockResolvedValue(null),
  };
}

function createMockAccessLogWriter(): AccessLogWriter {
  return {
    write: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAccessLogReader(): AccessLogReader {
  return {
    read: vi.fn().mockResolvedValue({
      logs: [],
      total: 0,
      limit: 50,
      offset: 0,
    }),
  };
}

describe("createApp", () => {
  let tempDir: string;
  let indexManager: IndexManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "app-test-"));
    const db = initializeDatabase(":memory:");
    indexManager = createIndexManager(db);
  });

  afterEach(async () => {
    indexManager.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeApp() {
    const logger = pino({ level: "silent" });
    return createApp({
      logger,
      version: "0.0.1",
      startedAt: new Date(),
      indexManager,
      hierarchyOptions: { dataDir: join(tempDir, "data") },
      serverOrigin: SERVER_ORIGIN,
      serverOwner: ownerWallet.address,
      gateway: createMockGateway(),
      accessLogWriter: createMockAccessLogWriter(),
      accessLogReader: createMockAccessLogReader(),
    });
  }

  it("GET /health returns 200", async () => {
    const app = makeApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
  });

  it("ProtocolError returns correct status and JSON body", async () => {
    const app = makeApp();

    app.get("/test-protocol-error", () => {
      throw new MissingAuthError({ reason: "no token" });
    });

    const res = await app.request("/test-protocol-error");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe(401);
    expect(body.error.errorCode).toBe("MISSING_AUTH");
    expect(body.error.message).toBe("Missing authentication");
    expect(body.error.details).toEqual({ reason: "no token" });
  });

  it("unknown error returns 500 INTERNAL_ERROR", async () => {
    const app = makeApp();

    app.get("/test-unknown-error", () => {
      throw new Error("something broke");
    });

    const res = await app.request("/test-unknown-error");
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error.code).toBe(500);
    expect(body.error.errorCode).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error");
  });

  it("unknown route returns 404", async () => {
    const app = makeApp();
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error.code).toBe(404);
    expect(body.error.errorCode).toBe("NOT_FOUND");
  });

  // --- Phase 3: Auth integration tests for owner-only routes ---

  it("DELETE /v1/data/:scope without auth → 401 MISSING_AUTH", async () => {
    const app = makeApp();
    const res = await app.request("/v1/data/test.scope", { method: "DELETE" });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.errorCode).toBe("MISSING_AUTH");
  });

  it("DELETE /v1/data/:scope with non-owner auth → 401 NOT_OWNER", async () => {
    const app = makeApp();
    const auth = await buildWeb3SignedHeader({
      wallet: nonOwnerWallet,
      aud: SERVER_ORIGIN,
      method: "DELETE",
      uri: "/v1/data/test.scope",
    });
    const res = await app.request("/v1/data/test.scope", {
      method: "DELETE",
      headers: { authorization: auth },
    });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.errorCode).toBe("NOT_OWNER");
  });

  it("DELETE /v1/data/:scope with owner auth → 204", async () => {
    const app = makeApp();
    const auth = await buildWeb3SignedHeader({
      wallet: ownerWallet,
      aud: SERVER_ORIGIN,
      method: "DELETE",
      uri: "/v1/data/test.scope",
    });
    const res = await app.request("/v1/data/test.scope", {
      method: "DELETE",
      headers: { authorization: auth },
    });
    expect(res.status).toBe(204);
  });

  it("GET /v1/grants without auth → 401", async () => {
    const app = makeApp();
    const res = await app.request("/v1/grants");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.errorCode).toBe("MISSING_AUTH");
  });

  it("GET /v1/access-logs without auth → 401", async () => {
    const app = makeApp();
    const res = await app.request("/v1/access-logs");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.errorCode).toBe("MISSING_AUTH");
  });

  it("POST /v1/sync/trigger without auth → 401", async () => {
    const app = makeApp();
    const res = await app.request("/v1/sync/trigger", { method: "POST" });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.errorCode).toBe("MISSING_AUTH");
  });

  it("POST /v1/grants/verify without auth → 400 (public endpoint, no auth wall)", async () => {
    const app = makeApp();
    const res = await app.request("/v1/grants/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // 400 means it reached the handler (no auth wall) — body validation fails
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_BODY");
  });
});
