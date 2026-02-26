import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@opendatalabs/personal-server-ts-mcp";
import type { McpContext } from "@opendatalabs/personal-server-ts-mcp";

export interface McpRouteDeps {
  mcpContext: McpContext;
}

export function mcpRoute(deps: McpRouteDeps): Hono {
  const app = new Hono();

  app.all("/", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createMcpServer(deps.mcpContext);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
