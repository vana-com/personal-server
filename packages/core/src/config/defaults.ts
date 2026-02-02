import { join } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_VANA_DIR = join(homedir(), ".vana");
export const DEFAULT_SERVER_DIR = join(DEFAULT_VANA_DIR, "server");
export const DEFAULT_DATA_DIR = join(DEFAULT_VANA_DIR, "data");
export const DEFAULT_CONFIG_PATH = join(DEFAULT_SERVER_DIR, "config.json");
