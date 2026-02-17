import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createLocalOnlyMiddleware } from "./local-only.js";

function createTestApp() {
  const app = new Hono();
  const localOnly = createLocalOnlyMiddleware();

  app.post("/data", localOnly, (c) => c.json({ ok: true }));

  return app;
}

describe("createLocalOnlyMiddleware", () => {
  it("allows requests without tunnel headers", async () => {
    const app = createTestApp();
    const res = await app.request("/data", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("rejects requests with X-Forwarded-For header", async () => {
    const app = createTestApp();
    const res = await app.request("/data", {
      method: "POST",
      headers: { "X-Forwarded-For": "1.2.3.4" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.errorCode).toBe("LOCAL_ONLY");
  });

  it("rejects requests with x-ps-transport: tunnel header", async () => {
    const app = createTestApp();
    const res = await app.request("/data", {
      method: "POST",
      headers: { "x-ps-transport": "tunnel" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.errorCode).toBe("LOCAL_ONLY");
  });

  it("allows requests with x-ps-transport set to non-tunnel value", async () => {
    const app = createTestApp();
    const res = await app.request("/data", {
      method: "POST",
      headers: { "x-ps-transport": "direct" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects when both tunnel headers are present", async () => {
    const app = createTestApp();
    const res = await app.request("/data", {
      method: "POST",
      headers: {
        "X-Forwarded-For": "10.0.0.1",
        "x-ps-transport": "tunnel",
      },
    });
    expect(res.status).toBe(403);
  });
});
