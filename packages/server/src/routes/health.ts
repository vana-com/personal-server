import { Hono } from "hono";

import type { IdentityInfo } from "../app.js";

export interface HealthDeps {
  version: string;
  startedAt: Date;
  serverOwner?: `0x${string}`;
  identity?: IdentityInfo;
}

export function healthRoute(deps: HealthDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const uptimeMs = Date.now() - deps.startedAt.getTime();

    const identity = deps.identity
      ? {
          address: deps.identity.address,
          publicKey: deps.identity.publicKey,
          serverId: deps.identity.serverId,
        }
      : null;

    return c.json({
      status: "healthy",
      version: deps.version,
      uptime: Math.floor(uptimeMs / 1000),
      owner: deps.serverOwner ?? null,
      identity,
    });
  });

  return app;
}
