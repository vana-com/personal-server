import { loadConfig, saveConfig } from "../config/index.js";

export interface SyncCursor {
  /** Read the lastProcessedTimestamp from server.json */
  read(): Promise<string | null>;

  /** Write the lastProcessedTimestamp to server.json */
  write(timestamp: string): Promise<void>;
}

/**
 * Creates a cursor that reads/writes sync.lastProcessedTimestamp in server.json.
 * Uses loadConfig/saveConfig to preserve other config fields.
 */
export function createSyncCursor(configPath: string): SyncCursor {
  return {
    async read() {
      const config = await loadConfig({ configPath });
      return config.sync.lastProcessedTimestamp;
    },

    async write(timestamp) {
      const config = await loadConfig({ configPath });
      config.sync.lastProcessedTimestamp = timestamp;
      await saveConfig(config, { configPath });
    },
  };
}
