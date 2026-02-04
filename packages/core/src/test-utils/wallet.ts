/**
 * Test wallet utilities for Web3Signed auth testing.
 * Provides deterministic wallets and header builders for integration tests.
 */

import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";

export interface TestWallet {
  address: `0x${string}`;
  privateKey: `0x${string}`;
  signMessage(message: string): Promise<`0x${string}`>;
  signTypedData(params: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
}

/**
 * Create a deterministic test wallet from a seed index.
 * Seed 0 produces a fixed private key, seed N produces key = padded hex(N+1).
 */
export function createTestWallet(seed: number = 0): TestWallet {
  // Derive a deterministic private key from the seed.
  // Pad the (seed + 1) value to 32 bytes hex.
  const keyValue = (seed + 1).toString(16).padStart(64, "0");
  const privateKey = `0x${keyValue}` as `0x${string}`;
  const account: PrivateKeyAccount = privateKeyToAccount(privateKey);

  return {
    address: account.address,
    privateKey,
    async signMessage(message: string): Promise<`0x${string}`> {
      return account.signMessage({ message });
    },
    async signTypedData(params): Promise<`0x${string}`> {
      return account.signTypedData({
        domain: params.domain as Parameters<
          typeof account.signTypedData
        >[0]["domain"],
        types: params.types as Parameters<
          typeof account.signTypedData
        >[0]["types"],
        primaryType: params.primaryType,
        message: params.message,
      });
    },
  };
}

/** Base64url encode a string (no padding). */
function base64urlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Build a valid Web3Signed Authorization header value.
 * Format: "Web3Signed {base64url(payload)}.{signature}"
 *
 * The payload is JSON with sorted keys, signed via EIP-191.
 */
export async function buildWeb3SignedHeader(params: {
  wallet: TestWallet;
  aud: string;
  method: string;
  uri: string;
  bodyHash?: string;
  iat?: number;
  exp?: number;
  grantId?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    aud: params.aud,
    // SHA256 of empty string is a well-known constant
    bodyHash:
      params.bodyHash ??
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    exp: params.exp ?? now + 300,
    iat: params.iat ?? now,
    method: params.method,
    uri: params.uri,
  };

  if (params.grantId !== undefined) {
    payload["grantId"] = params.grantId;
  }

  // Sort keys for deterministic serialization
  const sortedPayload = Object.keys(payload)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = payload[key];
      return acc;
    }, {});

  const payloadJson = JSON.stringify(sortedPayload);
  const payloadBase64 = base64urlEncode(payloadJson);

  // Sign the base64url string via EIP-191
  const signature = await params.wallet.signMessage(payloadBase64);

  return `Web3Signed ${payloadBase64}.${signature}`;
}
