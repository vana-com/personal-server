import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, type TestServer } from "./helpers/server.js";
import { startMockGateway, type MockGateway } from "./helpers/mock-gateway.js";
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from "@opendatalabs/personal-server-ts-core/test-utils";

const wallet = createTestWallet(0);

describe("Data read endpoint (e2e)", () => {
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

  async function postData(scope: string, data: Record<string, unknown>) {
    const res = await fetch(`${server.url}/v1/data/${scope}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async function getListWithAuth(query = "") {
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: server.url,
      method: "GET",
      uri: "/v1/data",
    });
    const url = query
      ? `${server.url}/v1/data${query}`
      : `${server.url}/v1/data`;
    return fetch(url, {
      headers: { Authorization: header },
    });
  }

  it("GET /v1/data returns 401 without auth header", async () => {
    const res = await fetch(`${server.url}/v1/data`);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.errorCode).toBe("MISSING_AUTH");
  });

  it("GET /v1/data returns 200 with scopes array for valid auth", async () => {
    await postData("instagram.profile", { username: "test" });
    await postData("twitter.posts", { count: 10 });

    const res = await getListWithAuth();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.scopes).toBeDefined();
    expect(Array.isArray(body.scopes)).toBe(true);
    expect(body.scopes.length).toBeGreaterThanOrEqual(2);
  });

  it("GET /v1/data filters by scopePrefix", async () => {
    await postData("reddit.comments", { count: 5 });

    const res = await getListWithAuth("?scopePrefix=instagram");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.scopes.length).toBeGreaterThanOrEqual(1);
    for (const s of body.scopes) {
      expect(s.scope).toMatch(/^instagram/);
    }
  });

  it("GET /v1/data supports pagination", async () => {
    const res = await getListWithAuth("?limit=1&offset=0");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.scopes).toHaveLength(1);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });
});
