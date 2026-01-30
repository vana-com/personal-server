import type { MiddlewareHandler } from "hono";
import type { GatewayClient } from "@personal-server/core/gateway";
import type { VerifiedAuth } from "@personal-server/core/auth";
import { scopeCoveredByGrant } from "@personal-server/core/scopes";
import {
  GrantRequiredError,
  GrantRevokedError,
  GrantExpiredError,
  ScopeMismatchError,
  InvalidSignatureError,
  ProtocolError,
} from "@personal-server/core/errors";

/**
 * Parse the opaque `grant` string from the gateway response.
 * The grant field is a JSON-serialized EIP-712 grant payload containing
 * { user, builder, scopes, expiresAt, nonce }.
 */
function parseGrantPayload(grantString: string): {
  scopes: string[];
  expiresAt: number;
} {
  try {
    const parsed = JSON.parse(grantString) as {
      scopes?: string[];
      expiresAt?: number;
    };
    return {
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
    };
  } catch {
    return { scopes: [], expiresAt: 0 };
  }
}

/**
 * Enforces grant for data reads. Must run AFTER web3-auth middleware.
 * Fetches grant from Gateway, checks revocation/expiry/scope/grantee.
 * Sets c.set('grant', grantResponse).
 */
export function createGrantCheckMiddleware(params: {
  gateway: GatewayClient;
  serverOwner?: `0x${string}`;
}): MiddlewareHandler {
  const { gateway } = params;

  return async (c, next) => {
    if (c.get("devBypass")) {
      await next();
      return;
    }

    const auth = c.get("auth") as VerifiedAuth;

    try {
      // 1. Extract grantId from auth payload
      const grantId = auth.payload.grantId;
      if (!grantId) {
        throw new GrantRequiredError({
          reason: "No grantId in authorization payload",
        });
      }

      // 2. Fetch grant from Gateway
      const grant = await gateway.getGrant(grantId);
      if (!grant) {
        throw new GrantRequiredError({ reason: "Grant not found", grantId });
      }

      // 3. Check revocation — gateway uses revokedAt (null = not revoked)
      if (grant.revokedAt !== null) {
        throw new GrantRevokedError({ grantId: grant.id });
      }

      // 4. Parse the opaque grant string to extract scopes and expiresAt
      const grantPayload = parseGrantPayload(grant.grant);

      // 5. Check expiry (expiresAt > 0 && expiresAt < now means expired)
      if (grantPayload.expiresAt > 0) {
        const now = Math.floor(Date.now() / 1000);
        if (grantPayload.expiresAt < now) {
          throw new GrantExpiredError({ expiresAt: grantPayload.expiresAt });
        }
      }

      // 6. Check scope coverage — extract scope from route param
      const scope = c.req.param("scope");
      if (scope && !scopeCoveredByGrant(scope, grantPayload.scopes)) {
        throw new ScopeMismatchError({
          requestedScope: scope,
          grantedScopes: grantPayload.scopes,
        });
      }

      // 7. Check grantee — signer must be the grant's builder.
      //    Gateway returns granteeId (bytes32 builderId), not an address.
      //    Look up builder by signer address, then compare builder.id === grant.granteeId.
      const builder = await gateway.getBuilder(auth.signer);
      if (!builder || builder.id !== grant.granteeId) {
        throw new InvalidSignatureError({
          reason: "Request signer is not the grant builder",
          expected: grant.granteeId,
          actual: auth.signer,
        });
      }

      // Set grant on context for downstream handlers
      c.set("grant", grant);
      await next();
    } catch (err) {
      if (err instanceof ProtocolError) {
        return c.json(err.toJSON(), err.code as 401 | 403);
      }
      throw err;
    }
  };
}
