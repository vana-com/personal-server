import type { MiddlewareHandler } from "hono";
import type { GatewayClient } from "@personal-server/core/gateway";
import type { VerifiedAuth } from "@personal-server/core/auth";
import { UnregisteredBuilderError } from "@personal-server/core/errors";

/**
 * Verifies authenticated signer is a registered builder via Gateway.
 * Must run AFTER web3-auth middleware.
 */
export function createBuilderCheckMiddleware(
  gateway: GatewayClient,
): MiddlewareHandler {
  return async (c, next) => {
    if (c.get("devBypass")) {
      await next();
      return;
    }

    const auth = c.get("auth") as VerifiedAuth;

    try {
      const registered = await gateway.isRegisteredBuilder(auth.signer);

      if (!registered) {
        const err = new UnregisteredBuilderError();
        return c.json(err.toJSON(), 401);
      }

      await next();
    } catch (err) {
      if (err instanceof UnregisteredBuilderError) {
        return c.json(err.toJSON(), 401);
      }
      throw err;
    }
  };
}
