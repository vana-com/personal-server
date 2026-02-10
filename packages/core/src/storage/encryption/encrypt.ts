import * as openpgp from "openpgp";

/**
 * Encrypt plaintext using OpenPGP password-based encryption.
 * Produces the same binary format as vana-sdk.
 *
 * @param plaintext - data to encrypt (typically JSON.stringify of envelope)
 * @param password - hex-encoded scope key from deriveScopeKey()
 * @returns OpenPGP encrypted binary (Uint8Array)
 */
export async function encryptWithPassword(
  plaintext: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  const message = await openpgp.createMessage({ binary: plaintext });
  const encrypted = await openpgp.encrypt({
    message,
    passwords: [password],
    format: "binary",
  });
  return encrypted as Uint8Array;
}
