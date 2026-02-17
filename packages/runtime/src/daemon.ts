/**
 * Self-daemonization for Personal Server.
 *
 * Uses `spawn()` with `{ detached: true, stdio: 'ignore' }` + `unref()`
 * to run the server as a background process.
 *
 * Cross-platform: uses `spawn()` (not `fork()`) because `fork()`
 * is broken on Windows for detached processes (nodejs/node#36808).
 */

import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { join } from "node:path";

export interface DaemonizeOptions {
  /** Path to the script to run (e.g. packages/server/dist/index.js). */
  scriptPath: string;
  /** Environment variables to pass to the child. */
  env?: Record<string, string>;
  /** Storage root for log output. */
  storageRoot: string;
  /** Path to the node binary. Default: process.execPath */
  nodePath?: string;
}

export interface DaemonizeResult {
  pid: number;
  logPath: string;
}

/**
 * Spawn the server as a detached background process.
 *
 * Stdout and stderr are redirected to a log file at
 * `{storageRoot}/daemon.log`. The parent process can exit
 * immediately after calling this.
 */
export function daemonize(options: DaemonizeOptions): DaemonizeResult {
  const {
    scriptPath,
    env = {},
    storageRoot,
    nodePath = process.execPath,
  } = options;

  const logPath = join(storageRoot, "daemon.log");

  // Open log file for stdout/stderr
  const logFd = openSync(logPath, "a");

  const child = spawn(nodePath, [scriptPath], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, ...env },
  });

  child.unref();
  closeSync(logFd);

  return {
    pid: child.pid!,
    logPath,
  };
}
