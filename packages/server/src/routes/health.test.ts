import { describe, it, expect } from "vitest";
import { healthRoute } from "./health.js";

describe("healthRoute", () => {
  const deps = { version: "0.0.1", startedAt: new Date() };

  function createApp() {
    return healthRoute(deps);
  }

  it("GET /health returns 200", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("body has status, version, uptime, and owner", async () => {
    const app = createApp();
    const res = await app.request("/health");
    const body = await res.json();

    expect(body.status).toBe("healthy");
    expect(body.version).toBe("0.0.1");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.owner).toBeNull();
  });

  it("includes owner when serverOwner is set", async () => {
    const app = healthRoute({
      version: "0.0.1",
      startedAt: new Date(),
      serverOwner: "0x1234567890abcdef1234567890abcdef12345678",
    });
    const res = await app.request("/health");
    const body = await res.json();

    expect(body.owner).toBe("0x1234567890abcdef1234567890abcdef12345678");
  });

  it("owner is null when serverOwner is not set", async () => {
    const app = healthRoute({ version: "0.0.1", startedAt: new Date() });
    const res = await app.request("/health");
    const body = await res.json();

    expect(body.owner).toBeNull();
  });

  it("uptime increases over time", async () => {
    const past = new Date(Date.now() - 5000);
    const app = healthRoute({ version: "0.0.1", startedAt: past });
    const res = await app.request("/health");
    const body = await res.json();

    expect(body.uptime).toBeGreaterThanOrEqual(5);
  });

  it("Content-Type is application/json", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });
});
