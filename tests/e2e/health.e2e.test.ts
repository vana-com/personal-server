import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server.js";
import { startMockGateway, type MockGateway } from "./helpers/mock-gateway.js";

describe("Health endpoint (e2e)", () => {
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

  it("GET /health returns 200 with healthy status", async () => {
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("healthy");
  });

  it("GET /health returns version and uptime", async () => {
    const res = await fetch(`${server.url}/health`);
    const body = await res.json();

    expect(typeof body.version).toBe("string");
    expect(body.version).toBeTruthy();
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("GET /health Content-Type is application/json", async () => {
    const res = await fetch(`${server.url}/health`);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("unknown route returns 404", async () => {
    const res = await fetch(`${server.url}/nonexistent`);
    expect(res.status).toBe(404);
  });
});
