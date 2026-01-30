import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";

export interface UiRouteDeps {
  devToken: string;
}

// Read the HTML file once at module load time
let cachedHtml: string | null = null;

function getHtmlPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "..", "ui", "index.html");
}

function loadHtml(devToken: string): string {
  if (!cachedHtml) {
    cachedHtml = readFileSync(getHtmlPath(), "utf-8");
  }
  return cachedHtml.replace("__DEV_TOKEN__", devToken);
}

export function uiRoute(deps: UiRouteDeps): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    try {
      const html = loadHtml(deps.devToken);
      return c.html(html);
    } catch {
      return c.json(
        {
          error: {
            code: 500,
            errorCode: "UI_ERROR",
            message: "Failed to load UI",
          },
        },
        500,
      );
    }
  });

  return app;
}
