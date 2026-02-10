/**
 * Sync routes — endpoints for triggering and monitoring the sync engine.
 * All endpoints require owner authentication.
 */

import { Hono } from "hono";
import type { Logger } from "pino";
import type { SyncManager } from "@opendatalabs/personal-server-ts-core/sync";
import { createWeb3AuthMiddleware } from "../middleware/web3-auth.js";
import { createOwnerCheckMiddleware } from "../middleware/owner-check.js";

export interface SyncRouteDeps {
  logger: Logger;
  serverOrigin: string | (() => string);
  serverOwner?: `0x${string}`;
  devToken?: string;
  syncManager: SyncManager | null; // null when sync disabled
}

export function syncRoutes(deps: SyncRouteDeps): Hono {
  const app = new Hono();

  const web3Auth = createWeb3AuthMiddleware({
    serverOrigin: deps.serverOrigin,
    devToken: deps.devToken,
    serverOwner: deps.serverOwner,
  });
  const ownerCheck = createOwnerCheckMiddleware(deps.serverOwner);

  // POST /trigger — request a full sync (owner auth required)
  app.post("/trigger", web3Auth, ownerCheck, async (c) => {
    if (!deps.syncManager) {
      return c.json(
        { status: "disabled", message: "Sync is not enabled" },
        200,
      );
    }
    await deps.syncManager.trigger();
    return c.json({ status: "started", message: "Sync triggered" }, 202);
  });

  // GET /status — current sync status (owner auth required)
  app.get("/status", web3Auth, ownerCheck, async (c) => {
    if (!deps.syncManager) {
      return c.json({
        enabled: false,
        running: false,
        lastSync: null,
        lastProcessedTimestamp: null,
        pendingFiles: 0,
        errors: [],
      });
    }
    return c.json(deps.syncManager.getStatus());
  });

  // POST /file/:fileId — request sync for a specific file (owner auth required)
  app.post("/file/:fileId", web3Auth, ownerCheck, async (c) => {
    const fileId = c.req.param("fileId");
    if (!deps.syncManager) {
      return c.json(
        { fileId, status: "disabled", message: "Sync is not enabled" },
        200,
      );
    }
    // Trigger a full sync (individual file sync is handled by the download worker
    // when it encounters the fileId from Gateway)
    deps.logger.info({ fileId }, "File sync requested, triggering full sync");
    await deps.syncManager.trigger();
    return c.json({ fileId, status: "started" }, 202);
  });

  return app;
}
