import { homedir } from "node:os";
import { resolve } from "node:path";
import { DEFAULT_ROOT_PATH } from "./defaults.js";

/**
 * Expands a leading "~" to the current user's home directory.
 */
export function expandHomePath(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return resolve(homedir(), input.slice(2));
  }
  return input;
}

/**
 * Resolves the configured root path (or default) to an absolute path.
 */
export function resolveRootPath(input?: string): string {
  return resolve(expandHomePath(input ?? DEFAULT_ROOT_PATH));
}
