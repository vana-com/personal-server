import { describe, it, expect } from "vitest";
import { recoverMessageAddress } from "viem";
import { createTestWallet } from "@opendatalabs/personal-server-ts-core/test-utils";
import { generateSignedClaim, base64urlEncode } from "./auth.js";

describe("tunnel/auth", () => {
  describe("base64urlEncode", () => {
    it("encodes a simple string", () => {
      const result = base64urlEncode("hello");
      expect(result).toBe("aGVsbG8");
    });

    it("removes padding", () => {
      const result = base64urlEncode("a");
      expect(result).toBe("YQ");
      expect(result).not.toContain("=");
    });

    it("replaces + with - and / with _", () => {
      // String that produces + and / in base64: "??>>"
      const input = "subjects?object";
      const result = base64urlEncode(input);
      expect(result).not.toContain("+");
      expect(result).not.toContain("/");
    });

    it("handles JSON payloads", () => {
      const payload = JSON.stringify({ foo: "bar", num: 123 });
      const result = base64urlEncode(payload);
      // Should be decodeable
      const decoded = Buffer.from(
        result.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf-8");
      expect(JSON.parse(decoded)).toEqual({ foo: "bar", num: 123 });
    });
  });

  describe("generateSignedClaim", () => {
    it("produces valid claim and signature", async () => {
      const wallet = createTestWallet(0);

      const { claim, sig } = await generateSignedClaim({
        ownerAddress: wallet.address,
        walletAddress: wallet.address,
        runId: "test-run-id",
        serverKeypair: {
          address: wallet.address,
          publicKey: `0x${"04".padEnd(130, "0")}` as `0x${string}`,
          signMessage: (msg: string) => wallet.signMessage(msg),
          signTypedData: () => Promise.resolve("0x" as `0x${string}`),
        },
      });

      expect(claim).toBeTruthy();
      expect(sig).toMatch(/^0x[a-fA-F0-9]+$/);
    });

    it("claim contains expected payload fields", async () => {
      const wallet = createTestWallet(0);

      const { claim } = await generateSignedClaim({
        ownerAddress: "0xOwner",
        walletAddress: "0xWallet",
        runId: "test-run-id",
        serverKeypair: {
          address: wallet.address,
          publicKey: `0x${"04".padEnd(130, "0")}` as `0x${string}`,
          signMessage: (msg: string) => wallet.signMessage(msg),
          signTypedData: () => Promise.resolve("0x" as `0x${string}`),
        },
      });

      // Decode the claim
      const decoded = Buffer.from(
        claim.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf-8");
      const payload = JSON.parse(decoded);

      expect(payload.aud).toBe("https://tunnel.vana.org");
      expect(payload.owner).toBe("0xOwner");
      expect(payload.wallet).toBe("0xWallet");
      expect(payload.subdomain).toBe("0xwallet"); // lowercased
      expect(payload.runId).toBe("test-run-id");
      expect(typeof payload.iat).toBe("number");
      expect(typeof payload.exp).toBe("number");
      expect(payload.exp - payload.iat).toBe(300); // 5 min TTL
    });

    it("subdomain is lowercased wallet address", async () => {
      const wallet = createTestWallet(0);
      const mixedCaseAddress = "0xABCdef1234567890ABCDEF1234567890abcdef12";

      const { claim } = await generateSignedClaim({
        ownerAddress: wallet.address,
        walletAddress: mixedCaseAddress,
        runId: "run-123",
        serverKeypair: {
          address: wallet.address,
          publicKey: `0x${"04".padEnd(130, "0")}` as `0x${string}`,
          signMessage: (msg: string) => wallet.signMessage(msg),
          signTypedData: () => Promise.resolve("0x" as `0x${string}`),
        },
      });

      const decoded = Buffer.from(
        claim.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf-8");
      const payload = JSON.parse(decoded);

      expect(payload.subdomain).toBe(mixedCaseAddress.toLowerCase());
    });

    it("signature is valid EIP-191 over claim string", async () => {
      const wallet = createTestWallet(0);

      const { claim, sig } = await generateSignedClaim({
        ownerAddress: wallet.address,
        walletAddress: wallet.address,
        runId: "verify-sig-test",
        serverKeypair: {
          address: wallet.address,
          publicKey: `0x${"04".padEnd(130, "0")}` as `0x${string}`,
          signMessage: (msg: string) => wallet.signMessage(msg),
          signTypedData: () => Promise.resolve("0x" as `0x${string}`),
        },
      });

      // Recover signer from signature
      const recoveredAddress = await recoverMessageAddress({
        message: claim,
        signature: sig as `0x${string}`,
      });

      expect(recoveredAddress.toLowerCase()).toBe(wallet.address.toLowerCase());
    });
  });
});
