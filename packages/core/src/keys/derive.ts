import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";

/**
 * Extracts master key material from EIP-191 signature over "vana-master-key-v1".
 * The raw signature bytes ARE the master key material (spec §2.3).
 * @param signature - 0x-prefixed hex string (65 bytes = 130 hex chars + 0x)
 * @returns 65-byte Uint8Array
 */
export function deriveMasterKey(signature: `0x${string}`): Uint8Array {
  const hex = signature.slice(2);

  if (hex.length !== 130) {
    throw new Error(
      `Invalid signature length: expected 130 hex chars (65 bytes), got ${hex.length}`,
    );
  }

  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Invalid signature: contains non-hex characters");
  }

  const bytes = new Uint8Array(65);
  for (let i = 0; i < 65; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Derives a scope-specific 32-byte key via HKDF-SHA256.
 * salt = "vana", info = "scope:{scope}" (spec §2.3).
 */
export function deriveScopeKey(
  masterKey: Uint8Array,
  scope: string,
): Uint8Array {
  const salt = new TextEncoder().encode("vana");
  const info = new TextEncoder().encode(`scope:${scope}`);
  return hkdf(sha256, masterKey, salt, info, 32);
}
