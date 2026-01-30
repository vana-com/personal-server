import { describe, it, expect } from "vitest";

import {
  InvalidSignatureError,
  GrantExpiredError,
  ScopeMismatchError,
} from "../errors/catalog.js";
import { createTestWallet } from "../test-utils/wallet.js";

import { GRANT_DOMAIN, GRANT_TYPES, grantToEip712Message } from "./eip712.js";
import type { GrantPayload, GrantWithSignature } from "./types.js";
import { verifyGrantLocal } from "./verify.js";

/** Helper: sign a grant payload with a wallet and return a GrantWithSignature. */
async function signGrant(
  wallet: ReturnType<typeof createTestWallet>,
  payload: GrantPayload,
): Promise<GrantWithSignature> {
  const signature = await wallet.signTypedData({
    domain: GRANT_DOMAIN as unknown as Record<string, unknown>,
    types: GRANT_TYPES as unknown as Record<
      string,
      Array<{ name: string; type: string }>
    >,
    primaryType: "Grant",
    message: grantToEip712Message(payload) as Record<string, unknown>,
  });
  return { grantId: "test-grant-1", payload, signature };
}

// Wallet 0 = owner (signs grants), Wallet 1 = builder (makes requests)
const owner = createTestWallet(0);
const builder = createTestWallet(1);

const futureExpiry = BigInt(Math.floor(Date.now() / 1000) + 3600);

function makePayload(overrides?: Partial<GrantPayload>): GrantPayload {
  return {
    user: owner.address,
    builder: builder.address,
    scopes: ["instagram.*"],
    expiresAt: futureExpiry,
    nonce: 1n,
    ...overrides,
  };
}

describe("verifyGrantLocal", () => {
  it("valid grant returns { valid: true, grant }", async () => {
    const payload = makePayload();
    const grant = await signGrant(owner, payload);

    const result = await verifyGrantLocal({
      grant,
      expectedOwner: owner.address,
      requestSigner: builder.address,
      requestedScope: "instagram.profile",
    });

    expect(result).toEqual({ valid: true, grant: payload });
  });

  it("wrong signer throws InvalidSignatureError", async () => {
    const payload = makePayload();
    // Sign with builder instead of owner
    const grant = await signGrant(builder, payload);

    await expect(
      verifyGrantLocal({
        grant,
        expectedOwner: owner.address,
        requestSigner: builder.address,
        requestedScope: "instagram.profile",
      }),
    ).rejects.toThrow(InvalidSignatureError);
  });

  it("expired grant throws GrantExpiredError", async () => {
    const payload = makePayload({ expiresAt: 1000n }); // far in the past
    const grant = await signGrant(owner, payload);

    await expect(
      verifyGrantLocal({
        grant,
        expectedOwner: owner.address,
        requestSigner: builder.address,
        requestedScope: "instagram.profile",
      }),
    ).rejects.toThrow(GrantExpiredError);
  });

  it("expiresAt = 0n (no expiry) passes", async () => {
    const payload = makePayload({ expiresAt: 0n });
    const grant = await signGrant(owner, payload);

    const result = await verifyGrantLocal({
      grant,
      expectedOwner: owner.address,
      requestSigner: builder.address,
      requestedScope: "instagram.profile",
    });

    expect(result.valid).toBe(true);
  });

  it("scope not covered throws ScopeMismatchError", async () => {
    const payload = makePayload({ scopes: ["twitter.*"] });
    const grant = await signGrant(owner, payload);

    await expect(
      verifyGrantLocal({
        grant,
        expectedOwner: owner.address,
        requestSigner: builder.address,
        requestedScope: "instagram.profile",
      }),
    ).rejects.toThrow(ScopeMismatchError);
  });

  it("scope covered by wildcard passes", async () => {
    const payload = makePayload({ scopes: ["*"] });
    const grant = await signGrant(owner, payload);

    const result = await verifyGrantLocal({
      grant,
      expectedOwner: owner.address,
      requestSigner: builder.address,
      requestedScope: "instagram.profile",
    });

    expect(result.valid).toBe(true);
  });

  it("request signer ≠ grant.builder throws InvalidSignatureError", async () => {
    const thirdParty = createTestWallet(2);
    const payload = makePayload();
    const grant = await signGrant(owner, payload);

    await expect(
      verifyGrantLocal({
        grant,
        expectedOwner: owner.address,
        requestSigner: thirdParty.address, // not the builder
        requestedScope: "instagram.profile",
      }),
    ).rejects.toThrow(InvalidSignatureError);
  });

  it("tampered payload throws InvalidSignatureError", async () => {
    const payload = makePayload();
    const grant = await signGrant(owner, payload);

    // Tamper with the payload after signing
    const tampered: GrantWithSignature = {
      ...grant,
      payload: { ...grant.payload, scopes: ["*"] },
    };

    await expect(
      verifyGrantLocal({
        grant: tampered,
        expectedOwner: owner.address,
        requestSigner: builder.address,
        requestedScope: "instagram.profile",
      }),
    ).rejects.toThrow(InvalidSignatureError);
  });

  it("multiple scopes, one matches, passes", async () => {
    const payload = makePayload({
      scopes: ["twitter.profile", "instagram.likes"],
    });
    const grant = await signGrant(owner, payload);

    const result = await verifyGrantLocal({
      grant,
      expectedOwner: owner.address,
      requestSigner: builder.address,
      requestedScope: "instagram.likes",
    });

    expect(result.valid).toBe(true);
  });
});
