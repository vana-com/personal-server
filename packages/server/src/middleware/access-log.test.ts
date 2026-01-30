import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createAccessLogMiddleware } from "./access-log.js";
import type {
  AccessLogWriter,
  AccessLogEntry,
} from "@personal-server/core/logging/access-log";
import type { VerifiedAuth } from "@personal-server/core/auth";
import type { GatewayGrantResponse } from "@personal-server/core/grants";

function createMockWriter(
  overrides: Partial<AccessLogWriter> = {},
): AccessLogWriter & { write: ReturnType<typeof vi.fn> } {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createApp(
  writer: AccessLogWriter,
  options: { status?: number; setAuth?: boolean; setGrant?: boolean } = {},
) {
  const { status = 200, setAuth = true, setGrant = true } = options;
  const app = new Hono();
  const accessLog = createAccessLogMiddleware(writer);

  const auth: VerifiedAuth = {
    signer: "0xBuilderAddress" as `0x${string}`,
    payload: {
      aud: "http://localhost:8080",
      method: "GET",
      uri: "/v1/data/instagram.profile",
      bodyHash: "",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      grantId: "grant-123",
    },
  };

  const grant: GatewayGrantResponse = {
    grantId: "grant-123",
    user: "0xOwnerAddress",
    builder: "0xBuilderAddress",
    scopes: ["instagram.*"],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    revoked: false,
  };

  // Simulate upstream middleware setting context
  app.use("/v1/data/:scope", async (c, next) => {
    if (setAuth) c.set("auth", auth);
    if (setGrant) c.set("grant", grant);
    await next();
  });

  app.get("/v1/data/:scope", accessLog, (c) => {
    return c.json({ ok: true }, status as 200);
  });

  // Route that returns 401 (simulating auth failure)
  app.use("/v1/fail/:scope", async (c, next) => {
    // Don't set auth/grant — simulating upstream failure
    await next();
  });
  app.get("/v1/fail/:scope", accessLog, (c) => {
    return c.json({ error: "unauthorized" }, 401);
  });

  return app;
}

describe("createAccessLogMiddleware", () => {
  it("200 response writes entry with correct fields", async () => {
    const writer = createMockWriter();
    const app = createApp(writer);

    const res = await app.request("/v1/data/instagram.profile", {
      headers: { "user-agent": "TestAgent/1.0" },
    });

    expect(res.status).toBe(200);
    expect(writer.write).toHaveBeenCalledOnce();

    const entry = writer.write.mock.calls[0][0] as AccessLogEntry;
    expect(entry.grantId).toBe("grant-123");
    expect(entry.builder).toBe("0xBuilderAddress");
    expect(entry.action).toBe("read");
    expect(entry.scope).toBe("instagram.profile");
    expect(entry.userAgent).toBe("TestAgent/1.0");
    expect(entry.logId).toBeDefined();
    expect(entry.timestamp).toBeDefined();
  });

  it("401 response does not write entry", async () => {
    const writer = createMockWriter();
    const app = createApp(writer);

    const res = await app.request("/v1/fail/instagram.profile");

    expect(res.status).toBe(401);
    expect(writer.write).not.toHaveBeenCalled();
  });

  it("missing user-agent uses unknown", async () => {
    const writer = createMockWriter();
    const app = createApp(writer);

    const res = await app.request("/v1/data/instagram.profile");

    expect(res.status).toBe(200);
    expect(writer.write).toHaveBeenCalledOnce();

    const entry = writer.write.mock.calls[0][0] as AccessLogEntry;
    expect(entry.userAgent).toBe("unknown");
  });

  it("writer failure does not affect response", async () => {
    const writer = createMockWriter({
      write: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    const app = createApp(writer);

    const res = await app.request("/v1/data/instagram.profile");

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(writer.write).toHaveBeenCalledOnce();
  });
});
