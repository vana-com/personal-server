import type { MiddlewareHandler } from "hono";
import { verifyWeb3Signed } from "@opendatalabs/personal-server-ts-core/auth";
import { ProtocolError } from "@opendatalabs/personal-server-ts-core/errors";

export interface Web3AuthMiddlewareDeps {
  serverOrigin: string | (() => string);
  devToken?: string;
  serverOwner?: `0x${string}`;
}

/**
 * Parses + verifies Web3Signed Authorization header.
 * Sets c.set('auth', VerifiedAuth) for downstream handlers.
 *
 * When a devToken is configured and the request carries a matching
 * Bearer token, auth context is populated with the server owner
 * and c.set('devBypass', true) is set to skip downstream checks.
 */
export function createWeb3AuthMiddleware(
  depsOrOrigin: Web3AuthMiddlewareDeps | string,
): MiddlewareHandler {
  const deps: Web3AuthMiddlewareDeps =
    typeof depsOrOrigin === "string"
      ? { serverOrigin: depsOrOrigin }
      : depsOrOrigin;

  return async (c, next) => {
    // Dev token bypass: if configured and header matches, skip Web3Signed verification
    if (deps.devToken) {
      const authHeader = c.req.header("authorization");
      if (authHeader === `Bearer ${deps.devToken}`) {
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
        c.set("auth", {
          signer: deps.serverOwner,
          payload: {},
        });
        c.set("devBypass", true);
        await next();
        return;
      }
    }

    try {
      const auth = await verifyWeb3Signed({
        headerValue: c.req.header("authorization"),
        expectedOrigin:
          typeof deps.serverOrigin === "function"
            ? deps.serverOrigin()
            : deps.serverOrigin,
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
