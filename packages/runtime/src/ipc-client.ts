/**
 * IPC client for communicating with Personal Server over UDS.
 *
 * Sends standard HTTP requests over Unix domain socket.
 * Used by CLI commands (start, stop, status) and by Tauri backend.
 */

import { request as httpRequest, type IncomingMessage } from "node:http";
import { resolveSocketPath } from "./ipc-path.js";

export interface IpcClientOptions {
  /** Storage root for socket path resolution. */
  storageRoot: string;
  /** Request timeout in ms. Default: 5000 */
  timeoutMs?: number;
}

export interface IpcResponse {
  status: number;
  body: string;
}

export class IpcClient {
  private readonly socketPath: string;
  private readonly timeoutMs: number;

  constructor(options: IpcClientOptions) {
    this.socketPath = resolveSocketPath(options.storageRoot);
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  /** Send a GET request to the IPC server. */
  async get(path: string): Promise<IpcResponse> {
    return this.send("GET", path);
  }

  /** Send a POST request to the IPC server with a JSON body. */
  async post(path: string, body?: unknown): Promise<IpcResponse> {
    return this.send("POST", path, body);
  }

  /** Send a DELETE request to the IPC server. */
  async delete(path: string): Promise<IpcResponse> {
    return this.send("DELETE", path);
  }

  /** Parse response body as JSON. */
  static parseJson<T>(response: IpcResponse): T {
    return JSON.parse(response.body) as T;
  }

  private send(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<IpcResponse> {
    return new Promise((resolve, reject) => {
      const jsonBody = body !== undefined ? JSON.stringify(body) : undefined;

      const req = httpRequest(
        {
          socketPath: this.socketPath,
          method,
          path,
          headers: {
            ...(jsonBody
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(jsonBody),
                }
              : {}),
          },
          timeout: this.timeoutMs,
        },
        (res: IncomingMessage) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            resolve({ status: res.statusCode ?? 0, body: data });
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error("IPC request timed out"));
      });

      if (jsonBody) {
        req.write(jsonBody);
      }
      req.end();
    });
  }
}
