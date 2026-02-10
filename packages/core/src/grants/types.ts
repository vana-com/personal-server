/**
 * Grant types for the Vana Data Portability Protocol.
 * See protocol spec §5.3 for grant structure.
 */

export interface GrantPayload {
  user: `0x${string}`;
  builder: `0x${string}`;
  scopes: string[];
  expiresAt: bigint;
  nonce: bigint;
}

export interface GrantWithSignature {
  grantId: string;
  payload: GrantPayload;
  signature: `0x${string}`;
}

/** Gateway response for GET /v1/grants/{grantId} (unwrapped from envelope) */
export interface GatewayGrantResponse {
  id: string;
  grantorAddress: string;
  granteeId: string;
  grant: string;
  fileIds: string[];
  status: "pending" | "confirmed";
  addedAt: string;
  revokedAt: string | null;
  revocationSignature: string | null;
}
