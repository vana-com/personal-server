import * as openpgp from "openpgp";

/**
 * Decrypt an OpenPGP password-encrypted binary.
 *
 * @param encrypted - OpenPGP encrypted binary data
 * @param password - hex-encoded scope key
 * @returns plaintext Uint8Array
 * @throws if password is wrong or data is corrupted
 */
export async function decryptWithPassword(
  encrypted: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  const message = await openpgp.readMessage({ binaryMessage: encrypted });
  const { data } = await openpgp.decrypt({
    message,
    passwords: [password],
    format: "binary",
  });
  return data as Uint8Array;
}
