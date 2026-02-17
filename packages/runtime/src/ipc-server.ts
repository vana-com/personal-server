/**
 * IPC server using HTTP-over-UDS.
 *
 * Uses @hono/node-server's createAdaptorServer() to create an
 * http.Server that listens on a Unix domain socket (or named pipe
 * on Windows) instead of a TCP port.
 *
 * Security: socket file permissions set to 0600 (owner-only access).
 */

import { createServer, type Server } from "node:http";
import { unlink, chmod } from "node:fs/promises";
import { resolveSocketPath } from "./ipc-path.js";

export interface IpcServerOptions {
  /** Storage root for socket path resolution. */
  storageRoot: string;
  /** The request handler function (Hono's fetch adapter). */
  fetch: (request: Request) => Response | Promise<Response>;
}

/**
 * Create and start an IPC server listening on a Unix domain socket.
 *
 * Returns an object with the server instance, socket path, and
 * a close function for graceful shutdown.
 */
export async function createIpcServer(options: IpcServerOptions): Promise<{
  server: Server;
  socketPath: string;
  close: () => Promise<void>;
}> {
  const socketPath = resolveSocketPath(options.storageRoot);

  // Remove stale socket file if it exists
  try {
    await unlink(socketPath);
  } catch {
    // File doesn't exist — that's fine
  }

  // We use the Hono node adapter's fetch handler with a raw http.Server
  // since createAdaptorServer hardcodes listen behavior we don't want.
  // Instead, we import the request-to-fetch adapter ourselves.
  const { getRequestListener } = await import("@hono/node-server");
  const listener = getRequestListener(options.fetch);

  const server = createServer(listener);

  return new Promise((resolve, reject) => {
    server.on("error", reject);

    server.listen(socketPath, async () => {
      server.removeListener("error", reject);

      // Set socket permissions to owner-only on Unix
      if (process.platform !== "win32") {
        try {
          await chmod(socketPath, 0o600);
        } catch {
          // Best effort — some filesystems may not support this
        }
      }

      resolve({
        server,
        socketPath,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => {
              if (err) rej(err);
              else {
                // Clean up socket file
                unlink(socketPath)
                  .catch(() => {})
                  .then(res);
              }
            });
          }),
      });
    });
  });
}
