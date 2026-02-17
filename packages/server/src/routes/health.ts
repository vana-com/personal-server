import { Hono } from "hono";
import type { GatewayClient } from "@opendatalabs/personal-server-ts-core/gateway";
import type { Logger } from "pino";

import type { IdentityInfo } from "../app.js";
import type { TunnelStatusInfo } from "../tunnel/index.js";

export interface HealthDeps {
  version: string;
  startedAt: Date;
  port: number;
  serverOwner?: `0x${string}`;
  identity?: IdentityInfo;
  gateway?: GatewayClient;
  logger?: Logger;
  getTunnelStatus?: () => TunnelStatusInfo | null;
}

export function healthRoute(deps: HealthDeps): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    const uptimeMs = Date.now() - deps.startedAt.getTime();
    let serverId = deps.identity?.serverId ?? null;

    if (deps.identity && deps.gateway) {
      try {
        const server = await deps.gateway.getServer(deps.identity.address);
        serverId = server?.id ?? null;
      } catch (err) {
        // Keep health endpoint available even if gateway is unreachable.
        serverId = null;
        deps.logger?.debug(
          { err, serverAddress: deps.identity.address },
          "Gateway lookup failed during health check",
        );
      }
    }

    const identity = deps.identity
      ? {
          address: deps.identity.address,
          publicKey: deps.identity.publicKey,
          serverId,
        }
      : null;

    const tunnel = deps.getTunnelStatus?.() ?? null;

    return c.json({
      status: "healthy",
      version: deps.version,
      uptime: Math.floor(uptimeMs / 1000),
      owner: deps.serverOwner ?? null,
      identity,
      tunnel,
    });
  });

  // GET /status — lightweight status for DataBridge wrapper
  app.get("/status", (c) => {
    return c.json({
      status: "running",
      owner: deps.serverOwner ?? null,
      port: deps.port,
    });
  });

  return app;
}
