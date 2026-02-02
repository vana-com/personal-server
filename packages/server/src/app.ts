import { Hono } from "hono";
import { ProtocolError } from "@personal-server/core/errors";
import type { IndexManager } from "@personal-server/core/storage/index";
import type { HierarchyManagerOptions } from "@personal-server/core/storage/hierarchy";
import type { GatewayClient } from "@personal-server/core/gateway";
import type { AccessLogWriter } from "@personal-server/core/logging/access-log";
import type { AccessLogReader } from "@personal-server/core/logging/access-reader";
import { healthRoute } from "./routes/health.js";
import { dataRoutes } from "./routes/data.js";
import { grantsRoutes } from "./routes/grants.js";
import { accessLogsRoutes } from "./routes/access-logs.js";
import { syncRoutes } from "./routes/sync.js";
import { uiConfigRoutes } from "./routes/ui-config.js";
import { uiRoute } from "./routes/ui.js";
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
  indexManager: IndexManager;
  hierarchyOptions: HierarchyManagerOptions;
  serverOrigin: string;
  serverOwner?: `0x${string}`;
  identity?: IdentityInfo;
  gateway: GatewayClient;
  accessLogWriter: AccessLogWriter;
  accessLogReader: AccessLogReader;
  devToken?: string;
  configPath?: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Mount health route
  app.route(
    "/",
    healthRoute({
      version: deps.version,
      startedAt: deps.startedAt,
      serverOwner: deps.serverOwner,
      identity: deps.identity,
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
    }),
  );

  // Mount grants routes (POST /verify is public, GET / needs owner auth)
  app.route(
    "/v1/grants",
    grantsRoutes({
      logger: deps.logger,
      gateway: deps.gateway,
      serverOwner: deps.serverOwner,
      serverOrigin: deps.serverOrigin,
      devToken: deps.devToken,
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
