import { serve } from "@hono/node-server";
import { createRequire } from "node:module";
import { loadConfig } from "@opendatalabs/personal-server-ts-core/config";
import {
  createIpcServer,
  writePidFile,
  removePidFile,
} from "@opendatalabs/personal-server-ts-runtime";
import { createServer } from "./bootstrap.js";
import { verifyTunnelUrl } from "./tunnel/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const DRAIN_TIMEOUT_MS = 5_000;

async function main(): Promise<void> {
  const rootPath = process.env.PERSONAL_SERVER_ROOT_PATH;
  const config = await loadConfig({ rootPath });
  const context = await createServer(config, { rootPath });
  const { app, adminApp, logger, devToken, storageRoot } = context;

  // --- HTTP listener (protocol routes) ---
  const server = serve(
    { fetch: app.fetch, port: config.server.port },
    (info) => {
      logger.info(
        { port: info.port, version: pkg.version },
        "HTTP server started",
      );

      if (devToken) {
        logger.info(
          { url: `http://localhost:${info.port}/ui` },
          "Dev UI available",
        );
        logger.info({ devToken }, "Dev token (ephemeral)");
      }
    },
  );

  // --- IPC listener (admin routes via Unix domain socket) ---
  let closeIpc: (() => Promise<void>) | undefined;
  try {
    const ipc = await createIpcServer({
      storageRoot,
      fetch: adminApp.fetch,
    });
    closeIpc = ipc.close;
    logger.info({ socketPath: ipc.socketPath }, "IPC server started");

    // Write PID file after both listeners are up
    await writePidFile(storageRoot, {
      pid: process.pid,
      port: config.server.port,
      socketPath: ipc.socketPath,
      version: pkg.version,
      startedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(
      { err },
      "IPC server failed to start — admin routes unavailable via socket",
    );
  }

  // Fire-and-forget: gateway check + tunnel connect (slow operations)
  // HTTP server is already listening so POST /v1/data/:scope works immediately
  context.startBackgroundServices().then(() => {
    // Verify tunnel URL is reachable now that both HTTP server and tunnel are up
    const { tunnelManager, tunnelUrl } = context;
    if (
      tunnelUrl &&
      tunnelManager &&
      tunnelManager.getStatus().status !== "error"
    ) {
      logger.info({ tunnelUrl }, "Verifying tunnel URL is reachable...");
      verifyTunnelUrl(tunnelUrl).then((result) => {
        tunnelManager.setVerified(result.reachable, result.error);
        if (result.reachable) {
          logger.info(
            { tunnelUrl, attempts: result.attempts },
            "Tunnel URL verified",
          );
        } else {
          logger.warn(
            { tunnelUrl, attempts: result.attempts, error: result.error },
            "Tunnel URL not reachable — server running in local-only mode",
          );
        }
      });
    }
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "Shutdown signal received, draining connections");

    // Clean up PID file
    await removePidFile(storageRoot);

    // Clean up IPC server
    if (closeIpc) {
      try {
        await closeIpc();
      } catch {
        // Best effort
      }
    }

    // Clean up server context (tunnel, sync, db)
    await context.cleanup();

    server.close(() => {
      logger.info("Server stopped");
      process.exit(0);
    });

    // Force exit after drain timeout
    setTimeout(() => {
      logger.warn("Drain timeout exceeded, forcing exit");
      process.exit(1);
    }, DRAIN_TIMEOUT_MS).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
