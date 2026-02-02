import { readFile, writeFile } from "node:fs/promises";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { ServerConfigSchema } from "@opendatalabs/personal-server-ts-core/schemas";

export interface UiConfigRouteDeps {
  devToken: string;
  configPath: string;
}

export function uiConfigRoutes(deps: UiConfigRouteDeps): Hono {
  const app = new Hono();

  const requireDevToken: MiddlewareHandler = async (c, next) => {
    const authHeader = c.req.header("authorization");
    if (authHeader !== `Bearer ${deps.devToken}`) {
      return c.json(
        {
          error: {
            code: 401,
            errorCode: "UNAUTHORIZED",
            message: "Invalid dev token",
          },
        },
        401,
      );
    }
    await next();
  };

  // GET /ui/api/config — read config from disk
  app.get("/config", requireDevToken, async (c) => {
    try {
      const contents = await readFile(deps.configPath, "utf-8");
      const config = JSON.parse(contents);
      return c.json(config);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return c.json(
          {
            error: {
              code: 404,
              errorCode: "NOT_FOUND",
              message: "Config file not found",
            },
          },
          404,
        );
      }
      return c.json(
        {
          error: {
            code: 500,
            errorCode: "READ_ERROR",
            message: "Failed to read config",
          },
        },
        500,
      );
    }
  });

  // PUT /ui/api/config — validate and write config to disk
  app.put("/config", requireDevToken, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            code: 400,
            errorCode: "INVALID_BODY",
            message: "Invalid JSON body",
          },
        },
        400,
      );
    }

    const result = ServerConfigSchema.safeParse(body);
    if (!result.success) {
      return c.json(
        {
          error: {
            code: 400,
            errorCode: "VALIDATION_ERROR",
            message: "Invalid config",
            issues: result.error.issues,
          },
        },
        400,
      );
    }

    try {
      await writeFile(
        deps.configPath,
        JSON.stringify(result.data, null, 2) + "\n",
      );
      return c.json({ status: "saved", config: result.data });
    } catch {
      return c.json(
        {
          error: {
            code: 500,
            errorCode: "WRITE_ERROR",
            message: "Failed to write config",
          },
        },
        500,
      );
    }
  });

  return app;
}
