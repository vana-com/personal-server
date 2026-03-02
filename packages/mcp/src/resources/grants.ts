import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../types.js";

export function registerGrantsResource(
  server: McpServer,
  ctx: McpContext,
): void {
  server.registerResource(
    "grants",
    "vana://grants",
    {
      title: "Active Grants",
      description: "List all data access grants for this user",
      mimeType: "application/json",
    },
    async (uri) => {
      const grants = await ctx.gatewayClient.listGrantsByUser(ctx.serverOwner);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(grants, null, 2),
          },
        ],
      };
    },
  );
}
