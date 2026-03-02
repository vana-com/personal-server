import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../types.js";

export function registerListFilesTool(
  server: McpServer,
  ctx: McpContext,
): void {
  server.registerTool(
    "list_files",
    {
      title: "List Files",
      description:
        "List all data files, optionally filtered by scope prefix. Returns scope names, latest collection timestamps, and version counts.",
      inputSchema: {
        scopePrefix: z
          .string()
          .optional()
          .describe(
            "Filter scopes by prefix (e.g. 'instagram' to list all instagram.* scopes)",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Max results to return (default 100)"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Offset for pagination"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ scopePrefix, limit, offset }) => {
      const result = ctx.indexManager.listDistinctScopes({
        scopePrefix: scopePrefix ?? undefined,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { scopes: result.scopes, total: result.total },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
