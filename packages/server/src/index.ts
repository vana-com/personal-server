import { serve } from "@hono/node-server";
import { loadConfig } from "@opendatalabs/personal-server-ts-core/config";
import { createServer } from "./bootstrap.js";

const DRAIN_TIMEOUT_MS = 5_000;

async function main(): Promise<void> {
  const rootPath = process.env.PERSONAL_SERVER_ROOT_PATH;
  const config = await loadConfig({ rootPath });
  const { app, logger, devToken } = await createServer(config, { rootPath });

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
