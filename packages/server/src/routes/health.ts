import { Hono } from "hono";

export interface HealthDeps {
  version: string;
  startedAt: Date;
}

export function healthRoute(deps: HealthDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const uptimeMs = Date.now() - deps.startedAt.getTime();
    return c.json({
      status: "healthy",
      version: deps.version,
      uptime: Math.floor(uptimeMs / 1000),
    });
  });

  return app;
}
