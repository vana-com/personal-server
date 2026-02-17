/**
 * IPC socket path resolution.
 *
 * | Platform     | Path                                          |
 * |-------------|-----------------------------------------------|
 * | macOS/Linux | {storageRoot}/ipc.sock (fallback if >100 bytes)|
 * | Windows     | \\.\pipe\vana-personal-server                 |
 *
 * macOS has a 103-byte limit on Unix domain socket paths.
 * If the preferred path exceeds 100 bytes, falls back to
 * /tmp/vana-ps-{hash}.sock using a hash of the storage root.
 */

import { join } from "node:path";
import { createHash } from "node:crypto";

/** Max safe socket path length (macOS limit is 103, use 100 for safety). */
const MAX_SOCKET_PATH_LENGTH = 100;

const WINDOWS_PIPE_NAME = "\\\\.\\pipe\\vana-personal-server";

/**
 * Resolve the IPC socket/pipe path for the current platform.
 */
export function resolveSocketPath(storageRoot: string): string {
  if (process.platform === "win32") {
    return WINDOWS_PIPE_NAME;
  }

  const preferred = join(storageRoot, "ipc.sock");

  if (Buffer.byteLength(preferred, "utf-8") <= MAX_SOCKET_PATH_LENGTH) {
    return preferred;
  }

  // Fallback: hash the storage root to create a short path in /tmp
  const hash = createHash("sha256")
    .update(storageRoot)
    .digest("hex")
    .slice(0, 12);
  return `/tmp/vana-ps-${hash}.sock`;
}
