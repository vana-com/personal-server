/**
 * EIP-712 domain and type definitions for gateway write operations.
 * Must match the gateway's lib/eip712.ts exactly.
 */

import type { TypedDataDomain } from "viem";

import type { GatewayConfig } from "../schemas/server-config.js";

const DOMAIN_NAME = "Vana Data Portability";
const DOMAIN_VERSION = "1";

/** Build a domain for a specific verifying contract. */
function buildDomain(
  chainId: number,
  verifyingContract: `0x${string}`,
): TypedDataDomain {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

export function fileRegistrationDomain(config: GatewayConfig): TypedDataDomain {
  return buildDomain(
    config.chainId,
    config.contracts.dataRegistry as `0x${string}`,
  );
}

export function grantRegistrationDomain(
  config: GatewayConfig,
): TypedDataDomain {
  return buildDomain(
    config.chainId,
    config.contracts.dataPortabilityPermissions as `0x${string}`,
  );
}

export function grantRevocationDomain(config: GatewayConfig): TypedDataDomain {
  return buildDomain(
    config.chainId,
    config.contracts.dataPortabilityPermissions as `0x${string}`,
  );
}

export const FILE_REGISTRATION_TYPES = {
  FileRegistration: [
    { name: "ownerAddress", type: "address" },
    { name: "url", type: "string" },
    { name: "schemaId", type: "bytes32" },
  ],
};

export const GRANT_REGISTRATION_TYPES = {
  GrantRegistration: [
    { name: "grantorAddress", type: "address" },
    { name: "granteeId", type: "bytes32" },
    { name: "grant", type: "string" },
    { name: "fileIds", type: "uint256[]" },
  ],
};

export const GRANT_REVOCATION_TYPES = {
  GrantRevocation: [
    { name: "grantorAddress", type: "address" },
    { name: "grantId", type: "bytes32" },
  ],
};

export interface FileRegistrationMessage {
  ownerAddress: `0x${string}`;
  url: string;
  schemaId: `0x${string}`;
}

export interface GrantRegistrationMessage {
  grantorAddress: `0x${string}`;
  granteeId: `0x${string}`;
  grant: string;
  fileIds: bigint[];
}

export interface GrantRevocationMessage {
  grantorAddress: `0x${string}`;
  grantId: `0x${string}`;
}

export function serverRegistrationDomain(
  config: GatewayConfig,
): TypedDataDomain {
  return buildDomain(
    config.chainId,
    config.contracts.dataPortabilityServer as `0x${string}`,
  );
}

export const SERVER_REGISTRATION_TYPES = {
  ServerRegistration: [
    { name: "ownerAddress", type: "address" },
    { name: "serverAddress", type: "address" },
    { name: "publicKey", type: "string" },
    { name: "serverUrl", type: "string" },
  ],
};

export interface ServerRegistrationMessage {
  ownerAddress: `0x${string}`;
  serverAddress: `0x${string}`;
  publicKey: `0x${string}`;
  serverUrl: string;
}
