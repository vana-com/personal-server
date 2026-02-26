import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readDataFile } from "@opendatalabs/personal-server-ts-core/storage/hierarchy";
import type { McpContext } from "../types.js";

export function registerSearchFilesTool(
  server: McpServer,
  ctx: McpContext,
): void {
  server.registerTool(
    "search_files",
    {
      title: "Search Files",
      description:
        "Search across all data files for a text query. Searches the JSON content of the latest version of each scope. Returns matching scopes with snippets.",
      inputSchema: {
        query: z.string().describe("Text to search for (case-insensitive)"),
        scopePrefix: z
          .string()
          .optional()
          .describe("Limit search to scopes matching this prefix"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of matching scopes to return (default 10)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, scopePrefix, maxResults }) => {
      const limit = maxResults ?? 10;
      const { scopes } = ctx.indexManager.listDistinctScopes({
        scopePrefix: scopePrefix ?? undefined,
        limit: 500,
      });

      const matches: Array<{ scope: string; snippet: string }> = [];
      const lowerQuery = query.toLowerCase();

      for (const scopeSummary of scopes) {
        if (matches.length >= limit) break;

        const entry = ctx.indexManager.findLatestByScope(scopeSummary.scope);
        if (!entry) continue;

        try {
          const envelope = await readDataFile(
            ctx.hierarchyOptions,
            scopeSummary.scope,
            entry.collectedAt,
          );
          const content = JSON.stringify(envelope.data);
          const lowerContent = content.toLowerCase();
          const idx = lowerContent.indexOf(lowerQuery);
          if (idx !== -1) {
            const start = Math.max(0, idx - 100);
            const end = Math.min(content.length, idx + query.length + 100);
            const snippet =
              (start > 0 ? "..." : "") +
              content.slice(start, end) +
              (end < content.length ? "..." : "");
            matches.push({ scope: scopeSummary.scope, snippet });
          }
        } catch {
          continue;
        }
      }

      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No matches found for "${query}"`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                query,
                matches,
                totalScanned: scopes.length,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
