import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
import type { ServerConfig } from "@opendatalabs/personal-server-ts-core/schemas";
import {
  DEFAULT_ROOT_PATH,
  resolveRootPath,
} from "@opendatalabs/personal-server-ts-core/config";
import {
  createLogger,
  type Logger,
} from "@opendatalabs/personal-server-ts-core/logger";
import {
  initializeDatabase,
  createIndexManager,
  type IndexManager,
} from "@opendatalabs/personal-server-ts-core/storage/index";
import type { HierarchyManagerOptions } from "@opendatalabs/personal-server-ts-core/storage/hierarchy";
import { createGatewayClient } from "@opendatalabs/personal-server-ts-core/gateway";
import type { GatewayClient } from "@opendatalabs/personal-server-ts-core/gateway";
import { createAccessLogWriter } from "@opendatalabs/personal-server-ts-core/logging/access-log";
import { createAccessLogReader } from "@opendatalabs/personal-server-ts-core/logging/access-reader";
import type { AccessLogReader } from "@opendatalabs/personal-server-ts-core/logging/access-reader";
import {
  deriveMasterKey,
  recoverServerOwner,
  loadOrCreateServerAccount,
} from "@opendatalabs/personal-server-ts-core/keys";
import type { ServerAccount } from "@opendatalabs/personal-server-ts-core/keys";
import {
  createServerSigner,
  createRequestSigner,
} from "@opendatalabs/personal-server-ts-core/signing";
import type { ServerSigner } from "@opendatalabs/personal-server-ts-core/signing";
import {
  createSyncCursor,
  createSyncManager,
  type SyncManager,
} from "@opendatalabs/personal-server-ts-core/sync";
import { createVanaStorageAdapter } from "@opendatalabs/personal-server-ts-core/storage/adapters";
import type { Hono } from "hono";
import { createApp, type IdentityInfo } from "./app.js";
import { createAdminApp } from "./admin-app.js";
import { generateDevToken } from "./dev-token.js";
import { TunnelManager, ensureFrpcBinary } from "./tunnel/index.js";

export interface ServerContext {
  app: Hono;
  adminApp: Hono;
  logger: Logger;
  config: ServerConfig;
  startedAt: Date;
  storageRoot: string;
  indexManager: IndexManager;
  gatewayClient: GatewayClient;
  accessLogReader: AccessLogReader;
  serverAccount?: ServerAccount;
  serverSigner?: ServerSigner;
  syncManager: SyncManager | null;
  tunnelManager?: TunnelManager;
  tunnelUrl?: string;
  devToken?: string;
  startBackgroundServices: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export interface CreateServerOptions {
  rootPath?: string;
  /** @deprecated Use rootPath instead. */
  serverDir?: string;
  dataDir?: string;
}

export async function createServer(
  config: ServerConfig,
  options?: CreateServerOptions,
): Promise<ServerContext> {
  const logger = createLogger(config.logging);
  const startedAt = new Date();

  const storageRoot = resolveRootPath(
    options?.rootPath ?? options?.serverDir ?? DEFAULT_ROOT_PATH,
  );
  const dataDir = options?.dataDir ?? join(storageRoot, "data");
  const indexPath = join(storageRoot, "index.db");
  const configPath = join(storageRoot, "config.json");

  await mkdir(storageRoot, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const db = initializeDatabase(indexPath);
  const indexManager = createIndexManager(db);
  const hierarchyOptions: HierarchyManagerOptions = { dataDir };

  const gatewayClient = createGatewayClient(config.gateway.url);

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
    const keyPath = join(storageRoot, "key.json");
    serverAccount = loadOrCreateServerAccount(keyPath);
    logger.info(
      { owner: serverOwner, serverAddress: serverAccount.address },
      "Server signing account loaded",
    );

    serverSigner = createServerSigner(serverAccount, {
      chainId: config.gateway.chainId,
      contracts: config.gateway.contracts,
    });

    // Identity starts with serverId=null; background services will populate it
    identity = {
      address: serverAccount.address,
      publicKey: serverAccount.publicKey,
      serverId: null,
    };
  } else {
    logger.warn(
      "VANA_MASTER_KEY_SIGNATURE not set — owner-restricted endpoints will return 500",
    );
  }

  // Download frpc binary eagerly (auth-independent) so it's ready when the user signs in
  let frpcBinaryPath = "";
  if (config.tunnel.enabled) {
    try {
      frpcBinaryPath = await ensureFrpcBinary(storageRoot, {
        log: (msg) => logger.info(msg),
      });
    } catch (err) {
      logger.warn({ err }, "Failed to download frpc binary - tunnel disabled");
    }
  }

  // --- Sync engine setup ---
  let syncManager: SyncManager | null = null;

  if (
    config.sync.enabled &&
    masterKeySignature &&
    serverOwner &&
    serverAccount &&
    serverSigner
  ) {
    const masterKey = deriveMasterKey(masterKeySignature);

    const vanaConfig = config.storage.config.vana ?? {
      apiUrl: "https://storage.vana.com",
    };
    const requestSigner = createRequestSigner(serverAccount);
    const storageAdapter = createVanaStorageAdapter({
      apiUrl: vanaConfig.apiUrl,
      ownerAddress: serverOwner,
      signer: requestSigner,
    });

    const cursor = createSyncCursor(configPath);

    const uploadDeps = {
      indexManager,
      hierarchyOptions,
      storageAdapter,
      gateway: gatewayClient,
      signer: serverSigner,
      masterKey,
      serverOwner,
      logger,
    };

    const downloadDeps = {
      indexManager,
      hierarchyOptions,
      storageAdapter,
      gateway: gatewayClient,
      cursor,
      masterKey,
      serverOwner,
      logger,
    };

    syncManager = createSyncManager(uploadDeps, downloadDeps);
    syncManager.start();
    logger.info("Sync engine started");
  } else if (config.sync.enabled) {
    logger.warn(
      "Sync enabled in config but VANA_MASTER_KEY_SIGNATURE not set — sync disabled",
    );
  }

  const logsDir = join(storageRoot, "logs");
  await mkdir(logsDir, { recursive: true });
  const accessLogWriter = createAccessLogWriter(logsDir);
  const accessLogReader = createAccessLogReader(logsDir);

  // Generate ephemeral dev token when devUi is enabled
  const devToken = config.devUi.enabled ? generateDevToken() : undefined;

  // Mutable origin — starts with config value, updated when tunnel connects
  let effectiveOrigin = config.server.origin;

  // Mutable tunnelManager — set when tunnel starts in background
  let tunnelManager: TunnelManager | undefined;

  const app = createApp({
    logger,
    version: pkg.version,
    startedAt,
    port: config.server.port,
    indexManager,
    hierarchyOptions,
    serverOrigin: () => effectiveOrigin,
    serverOwner,
    identity,
    gateway: gatewayClient,
    accessLogWriter,
    accessLogReader,
    devToken,
    configPath,
    syncManager,
    serverSigner,
    getTunnelStatus: () => tunnelManager?.getStatus() ?? null,
  });

  const adminApp = createAdminApp({
    logger,
    indexManager,
    hierarchyOptions,
    gateway: gatewayClient,
    accessLogReader,
    serverOwner,
    syncManager,
    serverSigner,
  });

  const cleanup = async () => {
    if (tunnelManager) {
      await tunnelManager.stop();
    }
    if (syncManager) {
      await syncManager.stop();
    }
    indexManager.close();
  };

  const context: ServerContext = {
    app,
    adminApp,
    logger,
    config,
    startedAt,
    storageRoot,
    indexManager,
    gatewayClient,
    accessLogReader,
    serverAccount,
    serverSigner,
    syncManager,
    tunnelManager,
    tunnelUrl: undefined,
    devToken,
    startBackgroundServices: async () => {
      // --- Gateway registration check (slow: HTTP call) ---
      if (serverAccount && identity) {
        try {
          const serverInfo = await gatewayClient.getServer(
            serverAccount.address,
          );
          identity.serverId = serverInfo?.id ?? null;
        } catch {
          // Gateway unreachable — assume not registered
        }

        if (identity.serverId) {
          logger.info(
            "Server registered with gateway — signing delegation active",
          );
        } else {
          logger.warn(
            {
              serverAddress: serverAccount.address,
              publicKey: serverAccount.publicKey,
            },
            "Server not registered. Register personal server with the gateway to enable delegation.",
          );
        }
      }

      // --- Tunnel setup (slow: subprocess wait) ---
      if (
        config.tunnel.enabled &&
        serverOwner &&
        serverAccount &&
        frpcBinaryPath
      ) {
        tunnelManager = new TunnelManager(storageRoot);
        context.tunnelManager = tunnelManager;

        const runId = randomUUID();

        try {
          const url = await tunnelManager.start(
            {
              walletAddress: serverAccount.address,
              ownerAddress: serverOwner,
              serverKeypair: serverAccount,
              runId,
              serverAddr: config.tunnel.serverAddr,
              serverPort: config.tunnel.serverPort,
              localPort: config.server.port,
            },
            frpcBinaryPath,
          );
          logger.info({ tunnelUrl: url }, "Tunnel established");
          context.tunnelUrl = url;
          effectiveOrigin = url;

          if (!identity?.serverId) {
            logger.warn(
              "Tunnel started but server is not registered with gateway — tunnel will not route traffic. Run: npm run register-server",
            );
            tunnelManager.setVerified(
              false,
              "Server not registered with gateway",
            );
          }
        } catch (err) {
          logger.warn(
            { err },
            "Tunnel failed to connect - server running in local-only mode",
          );
          tunnelManager = undefined;
          context.tunnelManager = undefined;
        }
      } else if (config.tunnel.enabled && !frpcBinaryPath) {
        logger.warn("frpc binary not available — tunnel disabled");
      } else if (config.tunnel.enabled) {
        logger.warn(
          "Tunnel enabled in config but VANA_MASTER_KEY_SIGNATURE not set — tunnel disabled",
        );
      }
    },
    cleanup,
  };

  return context;
}
