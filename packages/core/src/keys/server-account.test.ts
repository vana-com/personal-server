import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { recoverTypedDataAddress } from "viem";

import { loadOrCreateServerAccount } from "./server-account.js";

describe("loadOrCreateServerAccount", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "server-account-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates key file when it doesn't exist", async () => {
    const keyPath = join(tempDir, "server", "key.json");
    const account = loadOrCreateServerAccount(keyPath);

    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const raw = await readFile(keyPath, "utf-8");
    const data = JSON.parse(raw);
    expect(data.address).toBe(account.address);
    expect(data.publicKey).toBe(account.publicKey);
    expect(data.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("loads existing key file on subsequent calls", () => {
    const keyPath = join(tempDir, "server", "key.json");
    const first = loadOrCreateServerAccount(keyPath);
    const second = loadOrCreateServerAccount(keyPath);

    expect(second.address).toBe(first.address);
    expect(second.publicKey).toBe(first.publicKey);
  });

  it("returns a public key starting with 0x04 (uncompressed)", () => {
    const keyPath = join(tempDir, "key.json");
    const account = loadOrCreateServerAccount(keyPath);

    expect(account.publicKey).toMatch(/^0x04/);
    // Uncompressed public key = 65 bytes = 130 hex chars + 0x prefix
    expect(account.publicKey.length).toBe(132);
  });

  it("key file has correct JSON structure", async () => {
    const keyPath = join(tempDir, "key.json");
    loadOrCreateServerAccount(keyPath);

    const raw = await readFile(keyPath, "utf-8");
    const data = JSON.parse(raw);

    expect(data).toHaveProperty("address");
    expect(data).toHaveProperty("publicKey");
    expect(data).toHaveProperty("privateKey");
    expect(Object.keys(data)).toHaveLength(3);
  });

  it("signTypedData produces a valid signature recoverable to the server address", async () => {
    const keyPath = join(tempDir, "key.json");
    const account = loadOrCreateServerAccount(keyPath);

    const domain = {
      name: "Test",
      version: "1",
      chainId: 1,
    };
    const types = {
      Message: [{ name: "content", type: "string" }],
    };
    const message = { content: "hello" };

    const signature = await account.signTypedData({
      domain,
      types,
      primaryType: "Message",
      message,
    });

    expect(signature).toMatch(/^0x[0-9a-fA-F]+$/);

    const recovered = await recoverTypedDataAddress({
      domain,
      types,
      primaryType: "Message",
      message,
      signature,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("creates parent directories if they don't exist", async () => {
    const keyPath = join(tempDir, "deep", "nested", "key.json");
    const account = loadOrCreateServerAccount(keyPath);

    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const raw = await readFile(keyPath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
