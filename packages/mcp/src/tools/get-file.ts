import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readDataFile } from "@opendatalabs/personal-server-ts-core/storage/hierarchy";
import type { McpContext } from "../types.js";

function extractByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function registerGetFileTool(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "get_file",
    {
      title: "Get File",
      description:
        "Get the content of a data file by scope. Returns the full data envelope or a filtered subset via dot-notation path (e.g. 'data.profile.name').",
      inputSchema: {
        scope: z.string().describe("The data scope (e.g. 'instagram.profile')"),
        at: z
          .string()
          .datetime()
          .optional()
          .describe(
            "Get the version closest to this ISO 8601 timestamp (default: latest)",
          ),
        path: z
          .string()
          .optional()
          .describe(
            "Dot-notation path to extract from the envelope (e.g. 'data.messages' or 'data.profile.name')",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ scope, at, path }) => {
      const entry = at
        ? ctx.indexManager.findClosestByScope(scope, at)
        : ctx.indexManager.findLatestByScope(scope);

      if (!entry) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No data found for scope: ${scope}`,
            },
          ],
          isError: true,
        };
      }

      const envelope = await readDataFile(
        ctx.hierarchyOptions,
        scope,
        entry.collectedAt,
      );

      let result: unknown = envelope;
      if (path) {
        result = extractByPath(envelope, path);
        if (result === undefined) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Path "${path}" not found in data for scope: ${scope}`,
              },
            ],
            isError: true,
          };
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
