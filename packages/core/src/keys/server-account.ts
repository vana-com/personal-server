/**
 * ServerAccount wraps a randomly generated private key for EIP-712 signing.
 * The key is persisted to disk so the same address survives restarts.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { TypedDataDomain } from "viem";

export interface SignTypedDataParams {
  domain: TypedDataDomain;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface ServerAccount {
  address: `0x${string}`;
  /** Uncompressed public key (65 bytes, 0x04 prefix). */
  publicKey: `0x${string}`;
  signTypedData(params: SignTypedDataParams): Promise<`0x${string}`>;
}

interface KeyFileData {
  address: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Loads an existing server keypair from disk, or generates a new random one
 * and persists it. Returns a ServerAccount suitable for EIP-712 signing.
 */
export function loadOrCreateServerAccount(keyPath: string): ServerAccount {
  let privateKey: `0x${string}`;

  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath, "utf-8");
    const data: KeyFileData = JSON.parse(raw);
    privateKey = data.privateKey as `0x${string}`;
  } else {
    privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    // Ensure parent directories exist
    mkdirSync(dirname(keyPath), { recursive: true });

    const data: KeyFileData = {
      address: account.address,
      publicKey: account.publicKey,
      privateKey,
    };
    writeFileSync(keyPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  const account = privateKeyToAccount(privateKey);

  return {
    address: account.address,
    publicKey: account.publicKey,
    async signTypedData(params: SignTypedDataParams): Promise<`0x${string}`> {
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
