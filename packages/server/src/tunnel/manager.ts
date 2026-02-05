/**
 * TunnelManager handles the frpc process lifecycle.
 *
 * Responsibilities:
 * - Select correct frpc binary for current platform/arch
 * - Generate signed claim and frpc.toml config
 * - Spawn frpc process
 * - Monitor process lifecycle
 * - Provide status for health endpoint
 */

import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, mkdir, chmod, access, constants } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerAccount } from "@opendatalabs/personal-server-ts-core/keys";
import { generateSignedClaim } from "./auth.js";
import { generateFrpcConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type TunnelStatus =
  | "stopped"
  | "starting"
  | "connected"
  | "disconnected"
  | "error";

export interface TunnelStatusInfo {
  enabled: boolean;
  status: TunnelStatus;
  publicUrl: string | null;
  connectedSince: string | null;
  error?: string;
}

export interface TunnelConfig {
  walletAddress: string;
  ownerAddress: string;
  serverKeypair: ServerAccount;
  runId: string;
  serverAddr: string;
  serverPort: number;
  localPort: number;
}

/**
 * Get the path to the frpc binary for the current platform/arch.
 */
function getFrpcBinaryPath(): string {
  const platform = process.platform;
  const arch = process.arch;

  let binaryName: string;

  if (platform === "darwin") {
    binaryName = arch === "arm64" ? "frpc_darwin_arm64" : "frpc_darwin_amd64";
  } else if (platform === "linux") {
    binaryName = "frpc_linux_amd64";
  } else if (platform === "win32") {
    binaryName = "frpc_windows_amd64.exe";
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  // Binary is in packages/server/bin/
  return join(__dirname, "..", "..", "bin", binaryName);
}

export class TunnelManager {
  private storageRoot: string;
  private process: ChildProcess | null = null;
  private status: TunnelStatus = "stopped";
  private publicUrl: string | null = null;
  private connectedSince: Date | null = null;
  private lastError: string | null = null;
  private config: TunnelConfig | null = null;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  /**
   * Start the frpc process with the given configuration.
   * Returns the public URL once the tunnel is established.
   */
  async start(config: TunnelConfig): Promise<string> {
    if (this.process) {
      throw new Error("Tunnel already running");
    }

    this.config = config;
    this.status = "starting";
    this.lastError = null;

    // Generate signed claim
    const { claim, sig } = await generateSignedClaim({
      ownerAddress: config.ownerAddress,
      walletAddress: config.walletAddress,
      runId: config.runId,
      serverKeypair: config.serverKeypair,
    });

    // Generate frpc.toml config
    const subdomain = config.walletAddress.toLowerCase();
    const frpcConfig = generateFrpcConfig({
      serverAddr: config.serverAddr,
      serverPort: config.serverPort,
      localPort: config.localPort,
      subdomain,
      walletAddress: config.walletAddress,
      ownerAddress: config.ownerAddress,
      runId: config.runId,
      authClaim: claim,
      authSig: sig,
    });

    // Write config to disk
    const tunnelDir = join(this.storageRoot, "tunnel");
    await mkdir(tunnelDir, { recursive: true });
    const configPath = join(tunnelDir, "frpc.toml");
    await writeFile(configPath, frpcConfig, "utf-8");

    // Get binary path and verify it exists
    const binaryPath = getFrpcBinaryPath();
    try {
      await access(binaryPath, constants.X_OK);
    } catch {
      // Try to make it executable
      try {
        await chmod(binaryPath, 0o755);
      } catch {
        throw new Error(
          `frpc binary not found or not executable: ${binaryPath}`,
        );
      }
    }

    // Spawn frpc process
    return new Promise((resolve, reject) => {
      const proc = spawn(binaryPath, ["-c", configPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.process = proc;

      let startupOutput = "";
      let resolved = false;

      const onData = (data: Buffer) => {
        const text = data.toString();
        startupOutput += text;

        // Check for successful connection
        if (
          text.includes("start proxy success") ||
          text.includes("login to server success")
        ) {
          if (!resolved) {
            resolved = true;
            this.status = "connected";
            this.connectedSince = new Date();
            this.publicUrl = `https://${subdomain}.server.vana.org`;
            resolve(this.publicUrl);
          }
        }

        // Check for errors
        if (
          text.includes("login to the server failed") ||
          text.includes("error")
        ) {
          // Don't reject immediately due to loginFailExit=false
          // Just log and continue trying
        }
      };

      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);

      proc.on("error", (err) => {
        this.status = "error";
        this.lastError = err.message;
        if (!resolved) {
          resolved = true;
          reject(new Error(`Failed to start frpc: ${err.message}`));
        }
      });

      proc.on("exit", (code) => {
        this.process = null;
        if (code !== 0 && !resolved) {
          this.status = "error";
          this.lastError = `frpc exited with code ${code}: ${startupOutput}`;
          resolved = true;
          reject(new Error(this.lastError));
        } else if (this.status === "connected") {
          this.status = "disconnected";
        }
      });

      // Timeout for startup
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // Even if we don't see the success message, the tunnel might still be working
          // Set as connected optimistically
          this.status = "connected";
          this.connectedSince = new Date();
          this.publicUrl = `https://${subdomain}.server.vana.org`;
          resolve(this.publicUrl);
        }
      }, 10000); // 10 second timeout
    });
  }

  /**
   * Stop the frpc process gracefully.
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    return new Promise((resolve) => {
      const proc = this.process!;

      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        proc.kill("SIGKILL");
        resolve();
      }, 5000);

      proc.on("exit", () => {
        clearTimeout(timeout);
        this.process = null;
        this.status = "stopped";
        this.publicUrl = null;
        this.connectedSince = null;
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      proc.kill("SIGTERM");
    });
  }

  /**
   * Check if the tunnel is currently running.
   */
  isRunning(): boolean {
    return this.process !== null && this.status === "connected";
  }

  /**
   * Get the current tunnel status.
   */
  getStatus(): TunnelStatusInfo {
    return {
      enabled: true,
      status: this.status,
      publicUrl: this.publicUrl,
      connectedSince: this.connectedSince?.toISOString() ?? null,
      error: this.lastError ?? undefined,
    };
  }

  /**
   * Get the public URL if connected.
   */
  getPublicUrl(): string | null {
    return this.publicUrl;
  }
}
