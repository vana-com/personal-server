/**
 * Web3Signed Authorization header parsing and verification.
 *
 * Header format: "Web3Signed {base64url(payload)}.{signature}"
 * Payload is JSON with fields: aud, method, uri, bodyHash, iat, exp, grantId?
 * Signature is EIP-191 over the base64url-encoded payload string.
 */

import { recoverMessageAddress } from "viem";
import {
  MissingAuthError,
  InvalidSignatureError,
  ExpiredTokenError,
} from "../errors/catalog.js";

export interface Web3SignedPayload {
  aud: string;
  method: string;
  uri: string;
  bodyHash: string;
  iat: number;
  exp: number;
  grantId?: string;
}

export interface VerifiedAuth {
  signer: `0x${string}`;
  payload: Web3SignedPayload;
}

const WEB3_SIGNED_PREFIX = "Web3Signed ";
const CLOCK_SKEW_SECONDS = 60;

/** Decode a base64url string (no padding) to UTF-8. */
function base64urlDecode(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  base64 += "=".repeat(padLength);
  return Buffer.from(base64, "base64").toString("utf-8");
}

/**
 * Parse "Web3Signed <base64url>.<signature>" header value.
 * Throws MissingAuthError if header is missing/empty.
 * Throws InvalidSignatureError if format is invalid.
 */
export function parseWeb3SignedHeader(headerValue: string | undefined): {
  payloadBase64: string;
  payload: Web3SignedPayload;
  signature: `0x${string}`;
} {
  if (!headerValue) {
    throw new MissingAuthError();
  }

  if (!headerValue.startsWith(WEB3_SIGNED_PREFIX)) {
    throw new InvalidSignatureError({ reason: "Missing Web3Signed prefix" });
  }

  const value = headerValue.slice(WEB3_SIGNED_PREFIX.length);
  const dotIndex = value.indexOf(".");
  if (dotIndex === -1 || dotIndex === 0 || dotIndex === value.length - 1) {
    throw new InvalidSignatureError({ reason: "Invalid header format" });
  }

  const payloadBase64 = value.slice(0, dotIndex);
  const signatureStr = value.slice(dotIndex + 1);

  if (!signatureStr.startsWith("0x")) {
    throw new InvalidSignatureError({ reason: "Invalid signature format" });
  }

  let payload: Web3SignedPayload;
  try {
    const decoded = base64urlDecode(payloadBase64);
    payload = JSON.parse(decoded) as Web3SignedPayload;
  } catch {
    throw new InvalidSignatureError({ reason: "Invalid payload encoding" });
  }

  return {
    payloadBase64,
    payload,
    signature: signatureStr as `0x${string}`,
  };
}

/**
 * Full verification: parse header, recover signer via EIP-191, check claims.
 *
 * Steps:
 * 1. Parse header -> base64url + signature
 * 2. Recover signer via recoverMessageAddress (EIP-191) over the base64url string
 * 3. Check aud === expectedOrigin, method === expectedMethod, uri === expectedPath
 * 4. Check iat/exp within clock skew (60s)
 * 5. Return { signer, payload }
 */
export async function verifyWeb3Signed(params: {
  headerValue: string | undefined;
  expectedOrigin: string;
  expectedMethod: string;
  expectedPath: string;
  now?: number;
}): Promise<VerifiedAuth> {
  const { payloadBase64, payload, signature } = parseWeb3SignedHeader(
    params.headerValue,
  );

  // Recover signer from EIP-191 signature over the base64url payload string
  let signer: `0x${string}`;
  try {
    signer = await recoverMessageAddress({
      message: payloadBase64,
      signature,
    });
  } catch {
    throw new InvalidSignatureError({ reason: "Signature recovery failed" });
  }

  // Verify claims
  if (payload.aud !== params.expectedOrigin) {
    throw new InvalidSignatureError({
      reason: "Audience mismatch",
      expected: params.expectedOrigin,
      actual: payload.aud,
    });
  }

  if (payload.method !== params.expectedMethod) {
    throw new InvalidSignatureError({
      reason: "Method mismatch",
      expected: params.expectedMethod,
      actual: payload.method,
    });
  }

  if (payload.uri !== params.expectedPath) {
    throw new InvalidSignatureError({
      reason: "URI mismatch",
      expected: params.expectedPath,
      actual: payload.uri,
    });
  }

  // Time checks
  const now = params.now ?? Math.floor(Date.now() / 1000);

  if (payload.exp < now - CLOCK_SKEW_SECONDS) {
    throw new ExpiredTokenError({ reason: "Token expired" });
  }

  if (payload.iat > now + CLOCK_SKEW_SECONDS) {
    throw new ExpiredTokenError({ reason: "Token issued in the future" });
  }

  return { signer, payload };
}
