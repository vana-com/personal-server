import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createWeb3AuthMiddleware } from "./web3-auth.js";
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from "@personal-server/core/test-utils";
import type { VerifiedAuth } from "@personal-server/core/auth";

const SERVER_ORIGIN = "http://localhost:8080";
const wallet = createTestWallet(0);

function createApp() {
  const app = new Hono();
  const web3Auth = createWeb3AuthMiddleware(SERVER_ORIGIN);

  app.get("/test", web3Auth, (c) => {
    const auth = c.get("auth") as VerifiedAuth;
    return c.json({
      signer: auth.signer,
      grantId: auth.payload.grantId ?? null,
    });
  });

  return app;
}

describe("createWeb3AuthMiddleware", () => {
  it("valid header sets auth and calls next", async () => {
    const app = createApp();
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: SERVER_ORIGIN,
      method: "GET",
      uri: "/test",
    });

    const res = await app.request("/test", {
      headers: { Authorization: header },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.signer).toBe(wallet.address);
  });

  it("missing header returns 401 MISSING_AUTH", async () => {
    const app = createApp();

    const res = await app.request("/test");

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.errorCode).toBe("MISSING_AUTH");
  });

  it("invalid signature returns 401 INVALID_SIGNATURE", async () => {
    const app = createApp();

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer xyz" },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.errorCode).toBe("INVALID_SIGNATURE");
  });

  it("expired token returns 401 EXPIRED_TOKEN", async () => {
    const app = createApp();
    const pastTime = Math.floor(Date.now() / 1000) - 600;
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: SERVER_ORIGIN,
      method: "GET",
      uri: "/test",
      iat: pastTime - 300,
      exp: pastTime,
    });

    const res = await app.request("/test", {
      headers: { Authorization: header },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.errorCode).toBe("EXPIRED_TOKEN");
  });

  it('signer accessible downstream via c.get("auth")', async () => {
    const app = createApp();
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: SERVER_ORIGIN,
      method: "GET",
      uri: "/test",
      grantId: "grant-123",
    });

    const res = await app.request("/test", {
      headers: { Authorization: header },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.signer).toBe(wallet.address);
    expect(json.grantId).toBe("grant-123");
  });
});

describe("createWeb3AuthMiddleware with dev token", () => {
  const DEV_TOKEN = "abc123devtoken";
  const SERVER_OWNER =
    "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`;

  function createDevApp() {
    const app = new Hono();
    const web3Auth = createWeb3AuthMiddleware({
      serverOrigin: SERVER_ORIGIN,
      devToken: DEV_TOKEN,
      serverOwner: SERVER_OWNER,
    });

    app.get("/test", web3Auth, (c) => {
      const auth = c.get("auth") as VerifiedAuth;
      return c.json({
        signer: auth.signer,
        devBypass: c.get("devBypass") ?? false,
      });
    });

    return app;
  }

  it("valid dev token bypasses Web3Signed verification", async () => {
    const app = createDevApp();

    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${DEV_TOKEN}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.signer).toBe(SERVER_OWNER);
    expect(json.devBypass).toBe(true);
  });

  it("invalid dev token falls through to Web3Signed verification", async () => {
    const app = createDevApp();

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wrong-token" },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.errorCode).toBe("INVALID_SIGNATURE");
  });

  it("no devToken configured — normal Web3Signed flow", async () => {
    const app = new Hono();
    const web3Auth = createWeb3AuthMiddleware({
      serverOrigin: SERVER_ORIGIN,
    });

    app.get("/test", web3Auth, (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer some-token" },
    });

    expect(res.status).toBe(401);
  });
});
