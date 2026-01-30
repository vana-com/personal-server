import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createOwnerCheckMiddleware } from "./owner-check.js";
import { createWeb3AuthMiddleware } from "./web3-auth.js";
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from "@personal-server/core/test-utils";

const SERVER_ORIGIN = "http://localhost:8080";
const ownerWallet = createTestWallet(0);
const otherWallet = createTestWallet(1);

function createApp() {
  const app = new Hono();
  const web3Auth = createWeb3AuthMiddleware(SERVER_ORIGIN);
  const ownerCheck = createOwnerCheckMiddleware(ownerWallet.address);

  app.get("/owner-only", web3Auth, ownerCheck, (c) => {
    return c.json({ ok: true });
  });

  return app;
}

describe("createOwnerCheckMiddleware", () => {
  it("signer matches owner (case-insensitive) — calls next", async () => {
    const app = createApp();
    const header = await buildWeb3SignedHeader({
      wallet: ownerWallet,
      aud: SERVER_ORIGIN,
      method: "GET",
      uri: "/owner-only",
    });

    const res = await app.request("/owner-only", {
      headers: { Authorization: header },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("signer does not match owner — 401 NOT_OWNER", async () => {
    const app = createApp();
    const header = await buildWeb3SignedHeader({
      wallet: otherWallet,
      aud: SERVER_ORIGIN,
      method: "GET",
      uri: "/owner-only",
    });

    const res = await app.request("/owner-only", {
      headers: { Authorization: header },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.errorCode).toBe("NOT_OWNER");
  });

  it("undefined serverOwner — returns 500 SERVER_NOT_CONFIGURED", async () => {
    const app = new Hono();
    const web3Auth = createWeb3AuthMiddleware(SERVER_ORIGIN);
    const ownerCheck = createOwnerCheckMiddleware(undefined);

    app.get("/no-owner", web3Auth, ownerCheck, (c) => {
      return c.json({ ok: true });
    });

    const header = await buildWeb3SignedHeader({
      wallet: ownerWallet,
      aud: SERVER_ORIGIN,
      method: "GET",
      uri: "/no-owner",
    });

    const res = await app.request("/no-owner", {
      headers: { Authorization: header },
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.errorCode).toBe("SERVER_NOT_CONFIGURED");
  });

  it("missing auth context — throws programming error", async () => {
    const app = new Hono();
    // Apply owner-check WITHOUT web3-auth — auth context will be missing
    const ownerCheck = createOwnerCheckMiddleware(ownerWallet.address);

    app.get("/broken", ownerCheck, (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request("/broken");

    // Hono converts unhandled throws to 500
    expect(res.status).toBe(500);
  });
});
