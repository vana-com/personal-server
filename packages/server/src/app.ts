import { Hono } from "hono";
import { cors } from "hono/cors";
import { ProtocolError } from "@opendatalabs/personal-server-ts-core/errors";
import type { IndexManager } from "@opendatalabs/personal-server-ts-core/storage/index";
import type { HierarchyManagerOptions } from "@opendatalabs/personal-server-ts-core/storage/hierarchy";
import type { GatewayClient } from "@opendatalabs/personal-server-ts-core/gateway";
import type { AccessLogWriter } from "@opendatalabs/personal-server-ts-core/logging/access-log";
import type { AccessLogReader } from "@opendatalabs/personal-server-ts-core/logging/access-reader";
import { healthRoute, type HealthDeps } from "./routes/health.js";
import { dataRoutes } from "./routes/data.js";
import { grantsRoutes } from "./routes/grants.js";
import { accessLogsRoutes } from "./routes/access-logs.js";
import { syncRoutes } from "./routes/sync.js";
import { uiConfigRoutes } from "./routes/ui-config.js";
import { uiRoute } from "./routes/ui.js";
import type { SyncManager } from "@opendatalabs/personal-server-ts-core/sync";
import type { ServerSigner } from "@opendatalabs/personal-server-ts-core/signing";
import type { Logger } from "pino";

export interface IdentityInfo {
  address: `0x${string}`;
  publicKey: `0x${string}`;
  serverId: string | null;
}

export interface AppDeps {
  logger: Logger;
  version: string;
  startedAt: Date;
  port: number;
  indexManager: IndexManager;
  hierarchyOptions: HierarchyManagerOptions;
  serverOrigin: string | (() => string);
  serverOwner?: `0x${string}`;
  identity?: IdentityInfo;
  gateway: GatewayClient;
  accessLogWriter: AccessLogWriter;
  accessLogReader: AccessLogReader;
  devToken?: string;
  configPath?: string;
  syncManager?: SyncManager | null;
  serverSigner?: ServerSigner;
  getTunnelStatus?: HealthDeps["getTunnelStatus"];
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // CORS — allow all origins for browser-based clients
  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      maxAge: 86400,
    }),
  );

  // Mount health route
  app.route(
    "/",
    healthRoute({
      version: deps.version,
      startedAt: deps.startedAt,
      port: deps.port,
      serverOwner: deps.serverOwner,
      identity: deps.identity,
      gateway: deps.gateway,
      logger: deps.logger,
      getTunnelStatus: deps.getTunnelStatus,
    }),
  );

  // Mount data routes (ingest + read + delete)
  app.route(
    "/v1/data",
    dataRoutes({
      indexManager: deps.indexManager,
      hierarchyOptions: deps.hierarchyOptions,
      logger: deps.logger,
      serverOrigin: deps.serverOrigin,
      serverOwner: deps.serverOwner,
      gateway: deps.gateway,
      accessLogWriter: deps.accessLogWriter,
      devToken: deps.devToken,
      syncManager: deps.syncManager ?? null,
    }),
  );

  // Mount grants routes (POST /verify is public, GET / and POST / need owner auth)
  app.route(
    "/v1/grants",
    grantsRoutes({
      logger: deps.logger,
      gateway: deps.gateway,
      serverOwner: deps.serverOwner,
      serverOrigin: deps.serverOrigin,
      devToken: deps.devToken,
      serverSigner: deps.serverSigner,
    }),
  );

  // Mount access-logs routes (all owner auth)
  app.route(
    "/v1/access-logs",
    accessLogsRoutes({
      logger: deps.logger,
      accessLogReader: deps.accessLogReader,
      serverOrigin: deps.serverOrigin,
      serverOwner: deps.serverOwner,
      devToken: deps.devToken,
    }),
  );

  // Mount sync routes (all owner auth)
  app.route(
    "/v1/sync",
    syncRoutes({
      logger: deps.logger,
      serverOrigin: deps.serverOrigin,
      serverOwner: deps.serverOwner,
      devToken: deps.devToken,
      syncManager: deps.syncManager ?? null,
    }),
  );

  // Mount dev UI routes when dev token is available
  if (deps.devToken) {
    app.route("/ui", uiRoute({ devToken: deps.devToken }));

    if (deps.configPath) {
      app.route(
        "/ui/api",
        uiConfigRoutes({
          devToken: deps.devToken,
          configPath: deps.configPath,
        }),
      );
    }
  }

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof ProtocolError) {
      deps.logger.warn({ err }, err.message);
      return c.json(err.toJSON(), err.code as 401 | 403 | 413);
    }

    deps.logger.error({ err }, "Unhandled error");
    return c.json(
      {
        error: {
          code: 500,
          errorCode: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      },
      500,
    );
  });

  // 404 fallback
  app.notFound((c) => {
    return c.json(
      {
        error: {
          code: 404,
          errorCode: "NOT_FOUND",
          message: "Not found",
        },
      },
      404,
    );
  });

  return app;
}
