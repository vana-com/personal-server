import type { MiddlewareHandler } from "hono";
import { verifyWeb3Signed } from "@personal-server/core/auth";
import { ProtocolError } from "@personal-server/core/errors";

/**
 * Parses + verifies Web3Signed Authorization header.
 * Sets c.set('auth', VerifiedAuth) for downstream handlers.
 */
export function createWeb3AuthMiddleware(
  serverOrigin: string,
): MiddlewareHandler {
  return async (c, next) => {
    try {
      const auth = await verifyWeb3Signed({
        headerValue: c.req.header("authorization"),
        expectedOrigin: serverOrigin,
        expectedMethod: c.req.method,
        expectedPath: new URL(c.req.url).pathname,
      });

      c.set("auth", auth);
      await next();
    } catch (err) {
      if (err instanceof ProtocolError) {
        return c.json(err.toJSON(), err.code as 401 | 403);
      }
      throw err;
    }
  };
}
