import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readDataFile } from "@opendatalabs/personal-server-ts-core/storage/hierarchy";
import type { McpContext } from "../types.js";

export function registerFilesResources(
  server: McpServer,
  ctx: McpContext,
): void {
  // List all data files (distinct scopes)
  server.registerResource(
    "files",
    "vana://files",
    {
      title: "All Data Files",
      description: "List all data scopes and their latest versions",
      mimeType: "application/json",
    },
    async (uri) => {
      const result = ctx.indexManager.listDistinctScopes({
        limit: 1000,
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result.scopes, null, 2),
          },
        ],
      };
    },
  );

  // Get file content by scope
  server.registerResource(
    "file",
    new ResourceTemplate("vana://file/{scope}", {
      list: async () => {
        const result = ctx.indexManager.listDistinctScopes({
          limit: 1000,
        });
        return {
          resources: result.scopes.map((s) => ({
            uri: `vana://file/${s.scope}`,
            name: s.scope,
            description: `Latest version from ${s.latestCollectedAt} (${s.versionCount} versions)`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Data File Content",
      description: "Get the latest content of a data file by scope",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const scope = params.scope as string;
      const entry = ctx.indexManager.findLatestByScope(scope);
      if (!entry) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `No data found for scope: ${scope}`,
            },
          ],
        };
      }
      const envelope = await readDataFile(
        ctx.hierarchyOptions,
        scope,
        entry.collectedAt,
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(envelope, null, 2),
          },
        ],
      };
    },
  );

  // File metadata by scope
  server.registerResource(
    "file-metadata",
    new ResourceTemplate("vana://file/{scope}/metadata", {
      list: async () => {
        const result = ctx.indexManager.listDistinctScopes({
          limit: 1000,
        });
        return {
          resources: result.scopes.map((s) => ({
            uri: `vana://file/${s.scope}/metadata`,
            name: `${s.scope} metadata`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Data File Metadata",
      description:
        "Get metadata about a data file (versions, size, timestamps)",
      mimeType: "application/json",
    },
    async (uri, params) => {
      const scope = params.scope as string;
      const entries = ctx.indexManager.findByScope({
        scope,
        limit: 100,
      });
      const total = ctx.indexManager.countByScope(scope);
      const metadata = {
        scope,
        totalVersions: total,
        versions: entries.map((e) => ({
          collectedAt: e.collectedAt,
          createdAt: e.createdAt,
          sizeBytes: e.sizeBytes,
          fileId: e.fileId,
        })),
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(metadata, null, 2),
          },
        ],
      };
    },
  );
}
