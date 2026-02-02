import { join } from "node:path";
import type { ServerConfig } from "@personal-server/core/schemas";
import {
  DEFAULT_SERVER_DIR,
  DEFAULT_DATA_DIR,
} from "@personal-server/core/config";
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
  loadOrCreateServerAccount,
} from "@personal-server/core/keys";
import type { ServerAccount } from "@personal-server/core/keys";
import { createServerSigner } from "@personal-server/core/signing";
import type { ServerSigner } from "@personal-server/core/signing";
import type { Hono } from "hono";
import { createApp, type IdentityInfo } from "./app.js";
import { generateDevToken } from "./dev-token.js";

export interface ServerContext {
  app: Hono;
  logger: Logger;
  config: ServerConfig;
  startedAt: Date;
  indexManager: IndexManager;
  gatewayClient: GatewayClient;
  accessLogReader: AccessLogReader;
  serverAccount?: ServerAccount;
  serverSigner?: ServerSigner;
  devToken?: string;
  cleanup: () => void;
}

export interface CreateServerOptions {
  serverDir?: string;
  dataDir?: string;
}

export async function createServer(
  config: ServerConfig,
  options?: CreateServerOptions,
): Promise<ServerContext> {
  const logger = createLogger(config.logging);
  const startedAt = new Date();

  const serverDir = options?.serverDir ?? DEFAULT_SERVER_DIR;
  const dataDir = options?.dataDir ?? DEFAULT_DATA_DIR;
  const indexPath = join(serverDir, "index.db");
  const configPath = join(serverDir, "config.json");

  const db = initializeDatabase(indexPath);
  const indexManager = createIndexManager(db);
  const hierarchyOptions: HierarchyManagerOptions = { dataDir };

  const gatewayClient = createGatewayClient(config.gateway.url);

  const serverOrigin = config.server.origin;

  // Derive server owner from VANA_MASTER_KEY_SIGNATURE env var
  const masterKeySignature = process.env.VANA_MASTER_KEY_SIGNATURE as
    | `0x${string}`
    | undefined;
  let serverOwner: `0x${string}` | undefined;

  let serverAccount: ServerAccount | undefined;
  let serverSigner: ServerSigner | undefined;
  let identity: IdentityInfo | undefined;

  if (masterKeySignature) {
    serverOwner = await recoverServerOwner(masterKeySignature);
    deriveMasterKey(masterKeySignature); // validate signature format
    logger.info({ owner: serverOwner }, "Server owner derived from master key");

    // Load or create server keypair from disk
    const keyPath = join(serverDir, "key.json");
    serverAccount = loadOrCreateServerAccount(keyPath);
    logger.info(
      { owner: serverOwner, serverAddress: serverAccount.address },
      "Server signing account loaded",
    );

    serverSigner = createServerSigner(serverAccount, {
      chainId: config.gateway.chainId,
      contracts: config.gateway.contracts,
    });

    // Check registration (Data Connect handles actual registration)
    let serverId: string | null = null;
    try {
      const serverInfo = await gatewayClient.getServer(serverAccount.address);
      serverId = serverInfo?.id ?? null;
    } catch {
      // Gateway unreachable — assume not registered
    }

    if (serverId) {
      logger.info("Server registered with gateway — signing delegation active");
    } else {
      logger.warn(
        {
          serverAddress: serverAccount.address,
          publicKey: serverAccount.publicKey,
        },
        "Server not registered. Register personal server with the gateway to enable delegation.",
      );
    }

    identity = {
      address: serverAccount.address,
      publicKey: serverAccount.publicKey,
      serverId,
    };
  } else {
    logger.warn(
      "VANA_MASTER_KEY_SIGNATURE not set — owner-restricted endpoints will return 500",
    );
  }

  const logsDir = join(serverDir, "logs");
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
    identity,
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
    serverAccount,
    serverSigner,
    devToken,
    cleanup,
  };
}
