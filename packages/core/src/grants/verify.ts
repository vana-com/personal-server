/**
 * Local grant verification — EIP-712 signature recovery + expiry/scope/grantee checks.
 * No network calls; operates entirely on the provided GrantWithSignature.
 */

import { verifyTypedData } from 'viem';

import {
  InvalidSignatureError,
  GrantExpiredError,
  ScopeMismatchError,
} from '../errors/catalog.js';
import { scopeCoveredByGrant } from '../scopes/match.js';

import { GRANT_DOMAIN, GRANT_TYPES, grantToEip712Message } from './eip712.js';
import type { GrantPayload, GrantWithSignature } from './types.js';

export interface GrantVerificationResult {
  valid: true;
  grant: GrantPayload;
}

/**
 * Local-only grant verification (no network):
 * 1. Recover signer from EIP-712 signature, verify === expectedOwner
 * 2. Check expiresAt (0 = no expiry, else > now)
 * 3. Check requestedScope ⊆ grantedScopes
 * 4. Check requestSigner === grant.builder
 */
export async function verifyGrantLocal(params: {
  grant: GrantWithSignature;
  expectedOwner: `0x${string}`;
  requestSigner: `0x${string}`;
  requestedScope: string;
  now?: number;
}): Promise<GrantVerificationResult> {
  const { grant, expectedOwner, requestSigner, requestedScope } = params;
  const { payload, signature } = grant;

  // 1. Verify EIP-712 signature was produced by expectedOwner
  let valid: boolean;
  try {
    valid = await verifyTypedData({
      address: expectedOwner,
      domain: GRANT_DOMAIN,
      types: GRANT_TYPES,
      primaryType: 'Grant' as const,
      message: {
        user: payload.user,
        builder: payload.builder,
        scopes: payload.scopes,
        expiresAt: payload.expiresAt,
        nonce: payload.nonce,
      },
      signature,
    });
  } catch {
    throw new InvalidSignatureError({ reason: 'EIP-712 signature verification failed' });
  }

  if (!valid) {
    throw new InvalidSignatureError({ reason: 'Grant signature does not match expected owner' });
  }

  // 2. Check expiry (0n = no expiry)
  if (payload.expiresAt !== 0n) {
    const now = params.now ?? Math.floor(Date.now() / 1000);
    if (Number(payload.expiresAt) < now) {
      throw new GrantExpiredError({ expiresAt: Number(payload.expiresAt) });
    }
  }

  // 3. Check scope coverage
  if (!scopeCoveredByGrant(requestedScope, payload.scopes)) {
    throw new ScopeMismatchError({
      requestedScope,
      grantedScopes: payload.scopes,
    });
  }

  // 4. Check request signer is the grant's builder
  if (requestSigner.toLowerCase() !== payload.builder.toLowerCase()) {
    throw new InvalidSignatureError({
      reason: 'Request signer is not the grant builder',
      expected: payload.builder,
      actual: requestSigner,
    });
  }

  return { valid: true, grant: payload };
}
