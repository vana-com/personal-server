/**
 * RequestSigner — produces Web3Signed Authorization headers for HTTP requests.
 * Used by the Vana Storage adapter for authenticated blob operations.
 */

import { createHash } from "node:crypto";
import type { ServerAccount } from "../keys/server-account.js";
import type { RequestSigner } from "../storage/adapters/vana.js";

/** Base64url encode a string (no padding). */
function base64urlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Create a RequestSigner that produces Web3Signed Authorization headers
 * using the server account's EIP-191 signing capability.
 */
export function createRequestSigner(account: ServerAccount): RequestSigner {
  return {
    async signRequest(params: {
      aud: string;
      method: string;
      uri: string;
      body?: Uint8Array;
    }): Promise<string> {
      const now = Math.floor(Date.now() / 1000);

      const payload: Record<string, unknown> = {
        aud: params.aud,
        bodyHash: params.body
          ? createHash("sha256").update(params.body).digest("hex")
          : "",
        exp: now + 300,
        iat: now,
        method: params.method,
        uri: params.uri,
      };

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
      const signature = await account.signMessage(payloadBase64);

      return `Web3Signed ${payloadBase64}.${signature}`;
    },
  };
}
