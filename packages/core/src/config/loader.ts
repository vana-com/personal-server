import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ServerConfigSchema,
  type ServerConfig,
} from "../schemas/server-config.js";
import { resolveRootPath } from "./paths.js";

export interface LoadConfigOptions {
  configPath?: string;
  rootPath?: string;
}

export async function loadConfig(
  options?: LoadConfigOptions,
): Promise<ServerConfig> {
  const configPath =
    options?.configPath ??
    join(resolveRootPath(options?.rootPath), "config.json");

  let raw: string | undefined;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      // File doesn't exist — will use empty object for defaults
    } else {
      throw err;
    }
  }

  const parsed = raw !== undefined ? JSON.parse(raw) : {};
  const config = ServerConfigSchema.parse(parsed);

  // Write back so that defaults are visible and editable in config.json
  const serialized = JSON.stringify(config, null, 2) + "\n";
  if (serialized !== raw) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, serialized);
  }

  return config;
}

export async function saveConfig(
  config: ServerConfig,
  options?: LoadConfigOptions,
): Promise<void> {
  const configPath =
    options?.configPath ??
    join(resolveRootPath(options?.rootPath), "config.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
