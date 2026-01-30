import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ServerConfigSchema,
  type ServerConfig,
} from "../schemas/server-config.js";
import { DEFAULT_CONFIG_PATH } from "./defaults.js";

export interface LoadConfigOptions {
  configPath?: string;
}

export async function loadConfig(
  options?: LoadConfigOptions,
): Promise<ServerConfig> {
  const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH;

  let raw: unknown = {};
  let fileMissing = false;
  try {
    const contents = await readFile(configPath, "utf-8");
    raw = JSON.parse(contents);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      fileMissing = true;
      raw = {};
    } else {
      throw err;
    }
  }

  const config = ServerConfigSchema.parse(raw);

  if (fileMissing && configPath === DEFAULT_CONFIG_PATH) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  }

  return config;
}
