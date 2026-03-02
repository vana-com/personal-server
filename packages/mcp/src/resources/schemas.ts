import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../types.js";

export function registerSchemasResource(
  server: McpServer,
  ctx: McpContext,
): void {
  server.registerResource(
    "schemas",
    "vana://schemas",
    {
      title: "Available Schemas",
      description: "List schemas for all data scopes that have data",
      mimeType: "application/json",
    },
    async (uri) => {
      const { scopes } = ctx.indexManager.listDistinctScopes({
        limit: 1000,
      });
      const schemas = await Promise.all(
        scopes.map(async (s) => {
          try {
            const schema = await ctx.gatewayClient.getSchemaForScope(s.scope);
            return schema ?? null;
          } catch {
            return null;
          }
        }),
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(schemas.filter(Boolean), null, 2),
          },
        ],
      };
    },
  );
}
