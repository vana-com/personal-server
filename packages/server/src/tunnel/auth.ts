/**
 * Tunnel authentication via EIP-191 signed claims.
 *
 * Generates signed claims for FRP server plugin-first Login/NewProxy validation.
 * The claim is a base64url-encoded JSON payload signed with EIP-191.
 */

import type { ServerAccount } from "@opendatalabs/personal-server-ts-core/keys";

/** Claim time-to-live in seconds. Used for refresh scheduling. */
export const CLAIM_TTL_SECONDS = 300;

export interface SignedClaim {
  claim: string; // base64url(payload)
  sig: string; // EIP-191 signature
}

export interface ClaimPayload {
  aud: string;
  iat: number;
  exp: number;
  owner: string;
  wallet: string;
  subdomain: string;
  runId: string;
}

export interface ClaimConfig {
  ownerAddress: string;
  walletAddress: string;
  runId: string;
  serverKeypair: ServerAccount;
}

/** Encode a UTF-8 string to base64url (no padding). */
export function base64urlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Generate a signed claim for tunnel authentication.
 *
 * The claim payload contains:
 * - aud: "https://tunnel.vana.org" (audience)
 * - iat: issued-at timestamp (seconds)
 * - exp: expiration timestamp (5 min TTL)
 * - owner: owner wallet address
 * - wallet: server wallet address
 * - subdomain: lowercased wallet address
 * - runId: unique per-process session ID
 *
 * The signature is EIP-191 over the base64url-encoded claim string.
 */
export async function generateSignedClaim(
  config: ClaimConfig,
): Promise<SignedClaim> {
  const now = Math.floor(Date.now() / 1000);

  const payload: ClaimPayload = {
    aud: "https://tunnel.vana.org",
    iat: now,
    exp: now + CLAIM_TTL_SECONDS,
    owner: config.ownerAddress,
    wallet: config.walletAddress,
    subdomain: config.walletAddress.toLowerCase(),
    runId: config.runId,
  };

  const claim = base64urlEncode(JSON.stringify(payload));
  const sig = await config.serverKeypair.signMessage(claim);

  return { claim, sig };
}
