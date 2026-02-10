import { describe, it, expect } from "vitest";
import * as openpgp from "openpgp";
import { encryptWithPassword } from "./encrypt.js";
import { decryptWithPassword } from "./decrypt.js";

const PASSWORD =
  "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

describe("encryptWithPassword + decryptWithPassword", () => {
  it("roundtrip returns original plaintext", async () => {
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ scope: "test.scope", data: "hello" }),
    );
    const encrypted = await encryptWithPassword(plaintext, PASSWORD);
    const decrypted = await decryptWithPassword(encrypted, PASSWORD);
    expect(decrypted).toEqual(plaintext);
  });

  it("different calls produce different ciphertext", async () => {
    const plaintext = new TextEncoder().encode("same data");
    const encrypted1 = await encryptWithPassword(plaintext, PASSWORD);
    const encrypted2 = await encryptWithPassword(plaintext, PASSWORD);
    // OpenPGP uses a random session key each time
    expect(Buffer.from(encrypted1).equals(Buffer.from(encrypted2))).toBe(false);
  });

  it("decrypt with wrong password throws", async () => {
    const plaintext = new TextEncoder().encode("secret data");
    const encrypted = await encryptWithPassword(plaintext, PASSWORD);
    const wrongPassword = "ff".repeat(32);
    await expect(
      decryptWithPassword(encrypted, wrongPassword),
    ).rejects.toThrow();
  });

  it("decrypt with corrupted ciphertext throws", async () => {
    const plaintext = new TextEncoder().encode("secret data");
    const encrypted = await encryptWithPassword(plaintext, PASSWORD);
    // Corrupt the middle of the ciphertext
    const corrupted = new Uint8Array(encrypted);
    const mid = Math.floor(corrupted.length / 2);
    corrupted[mid] ^= 0xff;
    corrupted[mid + 1] ^= 0xff;
    corrupted[mid + 2] ^= 0xff;
    await expect(decryptWithPassword(corrupted, PASSWORD)).rejects.toThrow();
  });

  it("large payload (1MB) encrypts/decrypts correctly", async () => {
    const plaintext = new Uint8Array(1024 * 1024);
    // Fill with a pattern
    for (let i = 0; i < plaintext.length; i++) {
      plaintext[i] = i % 256;
    }
    const encrypted = await encryptWithPassword(plaintext, PASSWORD);
    const decrypted = await decryptWithPassword(encrypted, PASSWORD);
    expect(decrypted).toEqual(plaintext);
  });

  it("output can be decrypted by raw openpgp.decrypt", async () => {
    const plaintext = new TextEncoder().encode("cross-compat test");
    const encrypted = await encryptWithPassword(plaintext, PASSWORD);

    // Decrypt using raw openpgp API directly (simulating external tool)
    const message = await openpgp.readMessage({ binaryMessage: encrypted });
    const { data } = await openpgp.decrypt({
      message,
      passwords: [PASSWORD],
      format: "binary",
    });
    expect(data as Uint8Array).toEqual(plaintext);
  });
});
