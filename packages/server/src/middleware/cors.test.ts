import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";

describe("CORS middleware", () => {
  function createApp() {
    const app = new Hono();
    app.use(
      "*",
      cors({
        origin: "*",
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        maxAge: 86400,
      }),
    );
    app.get("/test", (c) => c.json({ ok: true }));
    app.post("/test", (c) => c.json({ ok: true }));
    return app;
  }

  it("OPTIONS preflight returns correct CORS headers", async () => {
    const app = createApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, Authorization",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
      "Content-Type",
    );
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  it("regular GET includes Access-Control-Allow-Origin: *", async () => {
    const app = createApp();
    const res = await app.request("/test", {
      method: "GET",
      headers: { Origin: "https://example.com" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("regular POST includes Access-Control-Allow-Origin: *", async () => {
    const app = createApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        Origin: "https://example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: "test" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
