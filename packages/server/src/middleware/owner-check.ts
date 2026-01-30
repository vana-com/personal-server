import type { MiddlewareHandler } from "hono";
import { NotOwnerError } from "@personal-server/core/errors";
import type { VerifiedAuth } from "@personal-server/core/auth";

/**
 * Verifies the authenticated signer is the server owner.
 * Must run AFTER web3-auth middleware (expects c.get('auth')).
 * Compares addresses case-insensitively.
 */
export function createOwnerCheckMiddleware(
  serverOwner: `0x${string}`,
): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.get("auth") as VerifiedAuth | undefined;

    if (!auth) {
      throw new Error(
        "owner-check middleware requires web3-auth middleware to run first",
      );
    }

    if (auth.signer.toLowerCase() !== serverOwner.toLowerCase()) {
      const err = new NotOwnerError({
        signer: auth.signer,
        expected: serverOwner,
      });
      return c.json(err.toJSON(), 401);
    }

    await next();
  };
}
