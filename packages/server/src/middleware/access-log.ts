import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AccessLogWriter } from "@opendatalabs/personal-server-ts-core/logging/access-log";
import type { VerifiedAuth } from "@opendatalabs/personal-server-ts-core/auth";
import type { GatewayGrantResponse } from "@opendatalabs/personal-server-ts-core/grants";

/**
 * Logs builder data access AFTER successful response (2xx).
 * Fire-and-forget: write failures don't affect response.
 */
export function createAccessLogMiddleware(
  writer: AccessLogWriter,
): MiddlewareHandler {
  return async (c, next) => {
    await next();

    // Only log on 2xx responses
    if (c.res.status < 200 || c.res.status >= 300) {
      return;
    }

    const auth = c.get("auth") as VerifiedAuth | undefined;
    const grant = c.get("grant") as GatewayGrantResponse | undefined;

    if (!auth || !grant) {
      return;
    }

    const scope = c.req.param("scope") ?? "unknown";

    try {
      await writer.write({
        logId: randomUUID(),
        grantId: grant.id,
        builder: auth.signer,
        action: "read",
        scope,
        timestamp: new Date().toISOString(),
        ipAddress:
          c.req.header("x-forwarded-for") ??
          c.req.header("x-real-ip") ??
          "unknown",
        userAgent: c.req.header("user-agent") ?? "unknown",
      });
    } catch {
      // Fire-and-forget: write failures don't affect response
    }
  };
}
