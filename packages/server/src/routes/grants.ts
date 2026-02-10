/**
 * Grants routes — GET / (owner), POST / (create grant), POST /verify (public).
 */

import { Hono } from "hono";
import type { Logger } from "pino";
import { verifyTypedData } from "viem";
import type { GatewayClient } from "@opendatalabs/personal-server-ts-core/gateway";
import {
  GRANT_DOMAIN,
  GRANT_TYPES,
} from "@opendatalabs/personal-server-ts-core/grants";
import type { ServerSigner } from "@opendatalabs/personal-server-ts-core/signing";
import { createWeb3AuthMiddleware } from "../middleware/web3-auth.js";
import { createOwnerCheckMiddleware } from "../middleware/owner-check.js";

export interface GrantsRouteDeps {
  logger: Logger;
  gateway: GatewayClient;
  serverOwner?: `0x${string}`;
  serverOrigin: string | (() => string);
  devToken?: string;
  serverSigner?: ServerSigner;
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

interface CreateRequestBody {
  granteeAddress: `0x${string}`;
  scopes: string[];
  expiresAt?: number;
  nonce?: number;
}

function isValidCreateBody(body: unknown): body is CreateRequestBody {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return false;
  const b = body as Record<string, unknown>;

  if (
    typeof b.granteeAddress !== "string" ||
    !b.granteeAddress.startsWith("0x")
  )
    return false;
  if (!Array.isArray(b.scopes) || b.scopes.length === 0) return false;
  if (!b.scopes.every((s: unknown) => typeof s === "string")) return false;
  if (b.expiresAt !== undefined && typeof b.expiresAt !== "number")
    return false;
  if (b.nonce !== undefined && typeof b.nonce !== "number") return false;

  return true;
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

  const web3Auth = createWeb3AuthMiddleware({
    serverOrigin: deps.serverOrigin,
    devToken: deps.devToken,
    serverOwner: deps.serverOwner,
  });
  const ownerCheck = createOwnerCheckMiddleware(deps.serverOwner);

  // GET / — list all grants for the server owner (owner auth required)
  app.get("/", web3Auth, ownerCheck, async (c) => {
    if (!deps.serverOwner) {
      return c.json(
        {
          error: {
            code: 500,
            errorCode: "SERVER_NOT_CONFIGURED",
            message:
              "Server owner address not configured. Set VANA_MASTER_KEY_SIGNATURE environment variable.",
          },
        },
        500,
      );
    }
    const grants = await deps.gateway.listGrantsByUser(deps.serverOwner);
    return c.json({ grants });
  });

  // POST / — create a grant (owner-only, called by Desktop App)
  app.post("/", web3Auth, ownerCheck, async (c) => {
    if (!deps.serverOwner) {
      return c.json(
        {
          error: {
            code: 500,
            errorCode: "SERVER_NOT_CONFIGURED",
            message:
              "Server owner address not configured. Set VANA_MASTER_KEY_SIGNATURE environment variable.",
          },
        },
        500,
      );
    }

    if (!deps.serverSigner) {
      return c.json(
        {
          error: {
            code: 500,
            errorCode: "SERVER_SIGNER_NOT_CONFIGURED",
            message:
              "Server signer not configured. Set VANA_MASTER_KEY_SIGNATURE environment variable.",
          },
        },
        500,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "INVALID_BODY", message: "Invalid JSON body" },
        400,
      );
    }

    if (!isValidCreateBody(body)) {
      return c.json(
        {
          error: "INVALID_BODY",
          message:
            "Body must include granteeAddress (0x string) and scopes (non-empty string array)",
        },
        400,
      );
    }

    const { granteeAddress, scopes, expiresAt, nonce } = body;

    // Look up builder to get their on-chain ID
    const builder = await deps.gateway.getBuilder(granteeAddress);
    if (!builder) {
      return c.json(
        {
          error: {
            code: 404,
            errorCode: "BUILDER_NOT_REGISTERED",
            message: `Builder ${granteeAddress} is not registered on-chain`,
          },
        },
        404,
      );
    }

    // Build the grant payload JSON string
    const grantPayload = JSON.stringify({
      user: deps.serverOwner,
      builder: granteeAddress,
      scopes,
      expiresAt: expiresAt ?? 0,
      nonce: nonce ?? Date.now(),
    });

    // Sign EIP-712 GrantRegistration
    const signature = await deps.serverSigner.signGrantRegistration({
      grantorAddress: deps.serverOwner,
      granteeId: builder.id as `0x${string}`,
      grant: grantPayload,
      fileIds: [],
    });

    // Submit to Gateway
    const result = await deps.gateway.createGrant({
      grantorAddress: deps.serverOwner,
      granteeId: builder.id,
      grant: grantPayload,
      fileIds: [],
      signature,
    });

    return c.json({ grantId: result.grantId }, 201);
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
