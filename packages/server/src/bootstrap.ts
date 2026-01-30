import { join } from "node:path";
import type { ServerConfig } from "@personal-server/core/schemas";
import { DEFAULT_CONFIG_DIR } from "@personal-server/core/config";
import { createLogger, type Logger } from "@personal-server/core/logger";
import {
  initializeDatabase,
  createIndexManager,
  type IndexManager,
} from "@personal-server/core/storage/index";
import type { HierarchyManagerOptions } from "@personal-server/core/storage/hierarchy";
import { createGatewayClient } from "@personal-server/core/gateway";
import type { GatewayClient } from "@personal-server/core/gateway";
import { createAccessLogWriter } from "@personal-server/core/logging/access-log";
import { createAccessLogReader } from "@personal-server/core/logging/access-reader";
import type { AccessLogReader } from "@personal-server/core/logging/access-reader";
import {
  deriveMasterKey,
  recoverServerOwner,
} from "@personal-server/core/keys";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { generateDevToken } from "./dev-token.js";

export interface ServerContext {
  app: Hono;
  logger: Logger;
  config: ServerConfig;
  startedAt: Date;
  indexManager: IndexManager;
  gatewayClient: GatewayClient;
  accessLogReader: AccessLogReader;
  devToken?: string;
  cleanup: () => void;
}

export interface CreateServerOptions {
  configDir?: string;
}

export async function createServer(
  config: ServerConfig,
  options?: CreateServerOptions,
): Promise<ServerContext> {
  const logger = createLogger(config.logging);
  const startedAt = new Date();

  const configDir = options?.configDir ?? DEFAULT_CONFIG_DIR;
  const dataDir = join(configDir, "data");
  const indexPath = join(configDir, "index.db");
  const configPath = join(configDir, "server.json");

  const db = initializeDatabase(indexPath);
  const indexManager = createIndexManager(db);
  const hierarchyOptions: HierarchyManagerOptions = { dataDir };

  const gatewayClient = createGatewayClient(config.gatewayUrl);

  const serverPort = config.server.port;
  const serverOrigin = config.server.origin ?? `http://localhost:${serverPort}`;

  // Derive server owner from VANA_MASTER_KEY_SIGNATURE env var
  const masterKeySignature = process.env.VANA_MASTER_KEY_SIGNATURE as
    | `0x${string}`
    | undefined;
  let serverOwner: `0x${string}` | undefined;

  if (masterKeySignature) {
    serverOwner = await recoverServerOwner(masterKeySignature);
    deriveMasterKey(masterKeySignature); // validate signature format
    logger.info({ owner: serverOwner }, "Server owner derived from master key");
  } else {
    logger.warn(
      "VANA_MASTER_KEY_SIGNATURE not set — owner-restricted endpoints will return 500",
    );
  }

  const logsDir = join(configDir, "logs");
  const accessLogWriter = createAccessLogWriter(logsDir);
  const accessLogReader = createAccessLogReader(logsDir);

  // Generate ephemeral dev token when devUi is enabled
  const devToken = config.devUi.enabled ? generateDevToken() : undefined;

  const app = createApp({
    logger,
    version: "0.0.1",
    startedAt,
    indexManager,
    hierarchyOptions,
    serverOrigin,
    serverOwner,
    gateway: gatewayClient,
    accessLogWriter,
    accessLogReader,
    devToken,
    configPath,
  });

  const cleanup = () => {
    indexManager.close();
  };

  return {
    app,
    logger,
    config,
    startedAt,
    indexManager,
    gatewayClient,
    accessLogReader,
    devToken,
    cleanup,
  };
}
