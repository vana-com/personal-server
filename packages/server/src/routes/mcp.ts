import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@opendatalabs/personal-server-ts-mcp";
import type { McpContext } from "@opendatalabs/personal-server-ts-mcp";
import type { OAuthProvider } from "../oauth/provider.js";

export interface McpRouteDeps {
  mcpContext: McpContext;
  oauthProvider?: OAuthProvider;
  serverOrigin?: string | (() => string);
}

export function mcpRoute(deps: McpRouteDeps): Hono {
  const app = new Hono();

  app.all("/", async (c) => {
    // Require bearer token when OAuth is configured
    if (deps.oauthProvider) {
      const authHeader = c.req.header("authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        let origin: string;
        if (deps.serverOrigin) {
          const o =
            typeof deps.serverOrigin === "function"
              ? deps.serverOrigin()
              : deps.serverOrigin;
          origin = o || new URL(c.req.url).origin;
        } else {
          origin = new URL(c.req.url).origin;
        }
        return new Response(
          JSON.stringify({
            error: "Unauthorized",
            error_description: "Bearer token required",
          }),
          {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
              "Content-Type": "application/json",
            },
          },
        );
      }

      const token = authHeader.slice(7);
      const authInfo = deps.oauthProvider.verifyToken(token);
      if (!authInfo) {
        return new Response(
          JSON.stringify({
            error: "invalid_token",
            error_description: "Token expired or invalid",
          }),
          {
            status: 401,
            headers: {
              "WWW-Authenticate": 'Bearer error="invalid_token"',
              "Content-Type": "application/json",
            },
          },
        );
      }

      // Pass authInfo to the MCP transport
      const transport = new WebStandardStreamableHTTPServerTransport();
      const server = createMcpServer(deps.mcpContext);
      await server.connect(transport);
      return transport.handleRequest(c.req.raw, { authInfo });
    }

    // No OAuth configured — open access (dev/local mode)
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createMcpServer(deps.mcpContext);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
