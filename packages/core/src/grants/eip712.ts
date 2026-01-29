/**
 * EIP-712 domain and type definitions for grant signatures.
 * See protocol spec §4.1.9 for typed data structure.
 */

import type { TypedDataDomain } from 'viem';

import type { GrantPayload } from './types.js';

export const GRANT_DOMAIN: TypedDataDomain = {
  name: 'Vana Data Portability',
  version: '1',
  chainId: 14800,
  verifyingContract: '0x0000000000000000000000000000000000000000' as `0x${string}`,
} as const;

export const GRANT_TYPES = {
  Grant: [
    { name: 'user', type: 'address' },
    { name: 'builder', type: 'address' },
    { name: 'scopes', type: 'string[]' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

/** Convert a GrantPayload to the message object expected by EIP-712 signTypedData. */
export function grantToEip712Message(payload: GrantPayload): Record<string, unknown> {
  return {
    user: payload.user,
    builder: payload.builder,
    scopes: payload.scopes,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
  };
}
