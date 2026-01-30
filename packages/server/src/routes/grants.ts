/**
 * Grants routes — POST /verify (public endpoint).
 * Verifies EIP-712 grant signatures locally without network calls.
 */

import { Hono } from "hono";
import type { Logger } from "pino";
import { verifyTypedData } from "viem";
import type { GatewayClient } from "@personal-server/core/gateway";
import { GRANT_DOMAIN, GRANT_TYPES } from "@personal-server/core/grants";
import { createWeb3AuthMiddleware } from "../middleware/web3-auth.js";
import { createOwnerCheckMiddleware } from "../middleware/owner-check.js";

export interface GrantsRouteDeps {
  logger: Logger;
  gateway: GatewayClient;
  serverOwner: `0x${string}`;
  serverOrigin: string;
}

interface VerifyRequestBody {
  grantId: string;
  payload: {
    user: `0x${string}`;
    builder: `0x${string}`;
    scopes: string[];
    expiresAt: number;
    nonce: number;
  };
  signature: `0x${string}`;
}

function isValidVerifyBody(body: unknown): body is VerifyRequestBody {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return false;
  const b = body as Record<string, unknown>;

  if (typeof b.grantId !== "string" || b.grantId.length === 0) return false;
  if (typeof b.signature !== "string" || !b.signature.startsWith("0x"))
    return false;

  if (
    b.payload === null ||
    typeof b.payload !== "object" ||
    Array.isArray(b.payload)
  )
    return false;
  const p = b.payload as Record<string, unknown>;

  if (typeof p.user !== "string" || !p.user.startsWith("0x")) return false;
  if (typeof p.builder !== "string" || !p.builder.startsWith("0x"))
    return false;
  if (!Array.isArray(p.scopes) || p.scopes.length === 0) return false;
  if (!p.scopes.every((s: unknown) => typeof s === "string")) return false;
  if (typeof p.expiresAt !== "number") return false;
  if (typeof p.nonce !== "number") return false;

  return true;
}

export function grantsRoutes(deps: GrantsRouteDeps): Hono {
  const app = new Hono();

  const web3Auth = createWeb3AuthMiddleware(deps.serverOrigin);
  const ownerCheck = createOwnerCheckMiddleware(deps.serverOwner);

  // GET / — list all grants for the server owner (owner auth required)
  app.get("/", web3Auth, ownerCheck, async (c) => {
    const grants = await deps.gateway.listGrantsByUser(deps.serverOwner);
    return c.json({ grants });
  });

  // POST /verify — public endpoint, no auth required
  app.post("/verify", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "INVALID_BODY", message: "Invalid JSON body" },
        400,
      );
    }

    if (!isValidVerifyBody(body)) {
      return c.json(
        {
          error: "INVALID_BODY",
          message:
            "Body must include grantId (string), payload (object with user, builder, scopes, expiresAt, nonce), and signature (0x string)",
        },
        400,
      );
    }

    const { payload, signature } = body;

    // Verify EIP-712 signature — recover signer and check === payload.user
    let valid: boolean;
    try {
      valid = await verifyTypedData({
        address: payload.user as `0x${string}`,
        domain: GRANT_DOMAIN,
        types: GRANT_TYPES,
        primaryType: "Grant" as const,
        message: {
          user: payload.user,
          builder: payload.builder,
          scopes: payload.scopes,
          expiresAt: BigInt(payload.expiresAt),
          nonce: BigInt(payload.nonce),
        },
        signature: signature as `0x${string}`,
      });
    } catch {
      return c.json({
        valid: false,
        error: "EIP-712 signature verification failed",
      });
    }

    if (!valid) {
      return c.json({
        valid: false,
        error: "Grant signature does not match user",
      });
    }

    // Check expiry: expiresAt > 0 means there IS an expiry
    if (payload.expiresAt > 0) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.expiresAt < nowSeconds) {
        return c.json({ valid: false, error: "Grant has expired" });
      }
    }

    return c.json({
      valid: true,
      user: payload.user,
      builder: payload.builder,
      scopes: payload.scopes,
      expiresAt: payload.expiresAt,
    });
  });

  return app;
}
