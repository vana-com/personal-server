import { join } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_ROOT_PATH = join(homedir(), "personal-server");
export const DEFAULT_DATA_DIR = join(DEFAULT_ROOT_PATH, "data");
export const DEFAULT_CONFIG_PATH = join(DEFAULT_ROOT_PATH, "config.json");

/**
 * @deprecated Use DEFAULT_ROOT_PATH instead.
 */
export const DEFAULT_VANA_DIR = DEFAULT_ROOT_PATH;

/**
 * @deprecated Use DEFAULT_ROOT_PATH instead.
 */
export const DEFAULT_SERVER_DIR = DEFAULT_ROOT_PATH;
