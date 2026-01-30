import { serve } from "@hono/node-server";
import { loadConfig } from "@personal-server/core/config";
import { createServer } from "./bootstrap.js";

const DRAIN_TIMEOUT_MS = 5_000;

async function main(): Promise<void> {
  const config = await loadConfig();
  const { app, logger, devToken } = createServer(config);

  const server = serve(
    { fetch: app.fetch, port: config.server.port },
    (info) => {
      logger.info({ port: info.port, version: "0.0.1" }, "Server started");

      if (devToken) {
        logger.info(
          { url: `http://localhost:${info.port}/ui` },
          "Dev UI available",
        );
        logger.info({ devToken }, "Dev token (ephemeral)");
      }
    },
  );

  function shutdown(signal: string): void {
    logger.info({ signal }, "Shutdown signal received, draining connections");

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

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
