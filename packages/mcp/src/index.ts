#!/usr/bin/env node
import { join } from "node:path";
import pino from "pino";
import { loadConfig } from "@opendatalabs/personal-server-ts-core/config";
import {
  resolveRootPath,
  DEFAULT_ROOT_PATH,
} from "@opendatalabs/personal-server-ts-core/config";
import {
  initializeDatabase,
  createIndexManager,
} from "@opendatalabs/personal-server-ts-core/storage/index";
import { createGatewayClient } from "@opendatalabs/personal-server-ts-core/gateway";
import { recoverServerOwner } from "@opendatalabs/personal-server-ts-core/keys";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const rootPath = process.env.PERSONAL_SERVER_ROOT_PATH;
  const config = await loadConfig({ rootPath });

  // Logger writes to stderr so stdout stays clean for MCP protocol
  const logger = pino({ level: config.logging.level }, pino.destination(2));

  // Derive owner from master key signature (required)
  const masterKeySignature = process.env.VANA_MASTER_KEY_SIGNATURE as
    | `0x${string}`
    | undefined;
  if (!masterKeySignature) {
    logger.error("VANA_MASTER_KEY_SIGNATURE is required for MCP server");
    process.exit(1);
  }
  const serverOwner = await recoverServerOwner(masterKeySignature);
  logger.info({ owner: serverOwner }, "MCP server owner derived");

  // Initialize data layer (same paths as HTTP server)
  const storageRoot = resolveRootPath(rootPath ?? DEFAULT_ROOT_PATH);
  const dataDir = join(storageRoot, "data");
  const indexPath = join(storageRoot, "index.db");

  const db = initializeDatabase(indexPath);
  const indexManager = createIndexManager(db);
  const hierarchyOptions = { dataDir };
  const gatewayClient = createGatewayClient(config.gateway.url);

  // Create and start MCP server
  const mcpServer = createMcpServer({
    indexManager,
    hierarchyOptions,
    gatewayClient,
    serverOwner,
    logger,
  });

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  logger.info("MCP server connected via stdio");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await mcpServer.close();
    indexManager.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});
