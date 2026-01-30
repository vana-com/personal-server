import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server.js";
import { startMockGateway, type MockGateway } from "./helpers/mock-gateway.js";

describe("Data ingest endpoint (e2e)", () => {
  let server: TestServer;
  let gateway: MockGateway;

  beforeAll(async () => {
    gateway = await startMockGateway();
    server = await startTestServer({ gatewayUrl: gateway.url });
  });

  afterAll(async () => {
    await server.cleanup();
    await gateway.cleanup();
  });

  it("POST /v1/data/{scope} returns 201 with scope, collectedAt, status", async () => {
    const res = await fetch(`${server.url}/v1/data/instagram.profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser" }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.scope).toBe("instagram.profile");
    expect(body.collectedAt).toBeDefined();
    expect(body.status).toBe("stored");
  });

  it("POST /v1/data/{scope} collectedAt is valid ISO 8601", async () => {
    const res = await fetch(`${server.url}/v1/data/facebook.profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test" }),
    });
    const body = await res.json();

    expect(body).toHaveProperty("collectedAt");
    expect(typeof body.collectedAt).toBe("string");
    expect(body.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const date = new Date(body.collectedAt);
    expect(date.getTime()).toBeGreaterThan(0);
  });

  it("POST /v1/data/{scope} returns 400 for invalid scope", async () => {
    const res = await fetch(`${server.url}/v1/data/bad`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "test" }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe("INVALID_SCOPE");
  });

  it("POST /v1/data/{scope} returns 400 for non-JSON body", async () => {
    const res = await fetch(`${server.url}/v1/data/instagram.profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe("INVALID_BODY");
  });

  it("two POSTs create different versions", async () => {
    const res1 = await fetch(`${server.url}/v1/data/twitter.posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    expect(res1.status).toBe(201);
    const body1 = await res1.json();

    // Wait to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res2 = await fetch(`${server.url}/v1/data/twitter.posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 2 }),
    });
    expect(res2.status).toBe(201);
    const body2 = await res2.json();

    expect(body1.collectedAt).not.toBe(body2.collectedAt);
  });
});
