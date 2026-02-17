/**
 * Middleware that rejects requests arriving through the FRP tunnel.
 *
 * Detection:
 * - X-Forwarded-For header (added automatically by frps)
 * - x-ps-transport: "tunnel" header (set in frpc config)
 *
 * Apply to routes that must only be called locally (e.g. data ingest).
 */

import type { MiddlewareHandler } from "hono";

export function createLocalOnlyMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (
      c.req.header("x-forwarded-for") ||
      c.req.header("x-ps-transport") === "tunnel"
    ) {
      return c.json(
        {
          error: {
            code: 403,
            errorCode: "LOCAL_ONLY",
            message: "This endpoint is only accessible locally",
          },
        },
        403,
      );
    }
    await next();
  };
}
