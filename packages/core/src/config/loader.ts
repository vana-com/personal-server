import { readFile } from 'node:fs/promises'
import { ServerConfigSchema, type ServerConfig } from '../schemas/server-config.js'
import { DEFAULT_CONFIG_PATH } from './defaults.js'

export interface LoadConfigOptions {
  configPath?: string
}

export async function loadConfig(
  options?: LoadConfigOptions,
): Promise<ServerConfig> {
  const configPath = options?.configPath ?? DEFAULT_CONFIG_PATH

  let raw: unknown = {}
  try {
    const contents = await readFile(configPath, 'utf-8')
    raw = JSON.parse(contents)
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      // File doesn't exist — use defaults
      raw = {}
    } else {
      throw err
    }
  }

  return ServerConfigSchema.parse(raw)
}
