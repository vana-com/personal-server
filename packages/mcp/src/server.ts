import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./types.js";
import { registerFilesResources } from "./resources/files.js";
import { registerGrantsResource } from "./resources/grants.js";
import { registerSchemasResource } from "./resources/schemas.js";
import { registerListFilesTool } from "./tools/list-files.js";
import { registerGetFileTool } from "./tools/get-file.js";
import { registerSearchFilesTool } from "./tools/search-files.js";

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({
    name: "vana-personal-server",
    version: "0.0.1",
  });

  // Resources
  registerFilesResources(server, ctx);
  registerGrantsResource(server, ctx);
  registerSchemasResource(server, ctx);

  // Tools
  registerListFilesTool(server, ctx);
  registerGetFileTool(server, ctx);
  registerSearchFilesTool(server, ctx);

  return server;
}

export type { McpContext } from "./types.js";
