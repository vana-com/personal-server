/**
 * PID file management for Personal Server.
 *
 * Writes a `server.json` file containing PID, port, socket path, version,
 * and start time. Used by CLI and DataBridge to detect running instances.
 */

import { writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface ServerMetadata {
  pid: number;
  port: number;
  socketPath: string | null;
  version: string;
  startedAt: string;
}

const PID_FILENAME = "server.json";

/** Resolve the PID file path within the storage root. */
export function pidFilePath(storageRoot: string): string {
  return join(storageRoot, PID_FILENAME);
}

/** Write server metadata to the PID file. */
export async function writePidFile(
  storageRoot: string,
  metadata: ServerMetadata,
): Promise<void> {
  const filePath = pidFilePath(storageRoot);
  await writeFile(filePath, JSON.stringify(metadata, null, 2), "utf-8");
}

/** Read server metadata from the PID file. Returns null if file doesn't exist. */
export async function readPidFile(
  storageRoot: string,
): Promise<ServerMetadata | null> {
  try {
    const raw = await readFile(pidFilePath(storageRoot), "utf-8");
    return JSON.parse(raw) as ServerMetadata;
  } catch {
    return null;
  }
}

/** Remove the PID file. Ignores errors if the file doesn't exist. */
export async function removePidFile(storageRoot: string): Promise<void> {
  try {
    await unlink(pidFilePath(storageRoot));
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Check if the process recorded in the PID file is still running.
 * Returns the metadata if alive, null otherwise.
 * Cleans up stale PID files.
 */
export async function checkRunningServer(
  storageRoot: string,
): Promise<ServerMetadata | null> {
  const metadata = await readPidFile(storageRoot);
  if (!metadata) return null;

  try {
    // signal 0 tests if the process exists without actually sending a signal
    process.kill(metadata.pid, 0);
    return metadata;
  } catch {
    // Process is dead — clean up stale PID file
    await removePidFile(storageRoot);
    return null;
  }
}
