import { Hono } from "hono";

export interface HealthDeps {
  version: string;
  startedAt: Date;
  serverOwner?: `0x${string}`;
}

export function healthRoute(deps: HealthDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const uptimeMs = Date.now() - deps.startedAt.getTime();
    return c.json({
      status: "healthy",
      version: deps.version,
      uptime: Math.floor(uptimeMs / 1000),
      owner: deps.serverOwner ?? null,
    });
  });

  return app;
}
