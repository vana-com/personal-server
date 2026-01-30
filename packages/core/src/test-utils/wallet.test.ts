import { describe, it, expect } from "vitest";
import { createTestWallet, buildWeb3SignedHeader } from "./wallet.js";

describe("createTestWallet", () => {
  it("returns a valid Ethereum address", () => {
    const wallet = createTestWallet(0);
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("is deterministic across calls", () => {
    const w1 = createTestWallet(0);
    const w2 = createTestWallet(0);
    expect(w1.address).toBe(w2.address);
    expect(w1.privateKey).toBe(w2.privateKey);
  });
});

describe("buildWeb3SignedHeader", () => {
  it('returns string starting with "Web3Signed "', async () => {
    const wallet = createTestWallet(0);
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: "http://localhost:8080",
      method: "GET",
      uri: "/v1/data/instagram.profile",
    });
    expect(header.startsWith("Web3Signed ")).toBe(true);
  });

  it("has exactly one dot between payload and signature", async () => {
    const wallet = createTestWallet(0);
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: "http://localhost:8080",
      method: "GET",
      uri: "/v1/data/instagram.profile",
    });
    // Strip prefix, then split by dot
    const value = header.slice("Web3Signed ".length);
    const parts = value.split(".");
    // base64url payload + 0x-prefixed signature (which doesn't contain dots)
    expect(parts.length).toBe(2);
    expect(parts[0]!.length).toBeGreaterThan(0);
    expect(parts[1]!.length).toBeGreaterThan(0);
  });
});
