/**
 * TunnelManager handles the frpc process lifecycle.
 *
 * Responsibilities:
 * - Generate signed claim and frpc.toml config
 * - Spawn frpc process with a caller-provided binary path
 * - Monitor process lifecycle
 * - Periodically refresh the auth claim before it expires
 * - Provide status for health endpoint
 */

import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, mkdir, chmod, access, constants } from "node:fs/promises";
import { join } from "node:path";
import type { ServerAccount } from "@opendatalabs/personal-server-ts-core/keys";
import { generateSignedClaim, CLAIM_TTL_SECONDS } from "./auth.js";
import { generateFrpcConfig } from "./config.js";
import { buildTunnelUrl } from "./verify.js";

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

/** Refresh at 80% of TTL to leave buffer before expiry. */
const REFRESH_INTERVAL_MS = CLAIM_TTL_SECONDS * 0.8 * 1000;

/** Retry interval when a refresh attempt fails. */
const REFRESH_RETRY_MS = 30_000;

export class TunnelManager {
  private storageRoot: string;
  private process: ChildProcess | null = null;
  private status: TunnelStatus = "stopped";
  private publicUrl: string | null = null;
  private connectedSince: Date | null = null;
  private lastError: string | null = null;
  private config: TunnelConfig | null = null;
  private binaryPath: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  /**
   * Start the frpc process with the given configuration.
   * Returns the public URL once the tunnel is established.
   * Automatically schedules periodic claim refresh.
   */
  async start(config: TunnelConfig, binaryPath: string): Promise<string> {
    if (this.process) {
      throw new Error("Tunnel already running");
    }

    this.config = config;
    this.binaryPath = binaryPath;
    this.status = "starting";
    this.lastError = null;

    // Verify binary exists and is executable
    try {
      await access(binaryPath, constants.X_OK);
    } catch {
      try {
        await chmod(binaryPath, 0o755);
      } catch {
        throw new Error(
          `frpc binary not found or not executable: ${binaryPath}`,
        );
      }
    }

    const subdomain = config.walletAddress.toLowerCase();
    this.publicUrl = buildTunnelUrl(subdomain, config.serverAddr);

    const configPath = await this.writeFreshConfig(subdomain);
    await this.spawnProcess(configPath);

    this.scheduleRefresh();

    return this.publicUrl;
  }

  /**
   * Stop the frpc process gracefully.
   */
  async stop(): Promise<void> {
    this.clearRefreshTimer();

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
   * Update status based on external verification of the tunnel URL.
   */
  setVerified(reachable: boolean, error?: string): void {
    if (reachable) {
      this.status = "connected";
      this.lastError = null;
    } else {
      this.status = "error";
      this.lastError = error ?? "Tunnel URL not reachable";
    }
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate a fresh signed claim, write frpc.toml, and return the config path.
   */
  private async writeFreshConfig(subdomain: string): Promise<string> {
    const config = this.config!;

    const { claim, sig } = await generateSignedClaim({
      ownerAddress: config.ownerAddress,
      walletAddress: config.walletAddress,
      runId: config.runId,
      serverKeypair: config.serverKeypair,
    });

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

    const tunnelDir = join(this.storageRoot, "tunnel");
    await mkdir(tunnelDir, { recursive: true });
    const configPath = join(tunnelDir, "frpc.toml");
    await writeFile(configPath, frpcConfig, "utf-8");

    return configPath;
  }

  /**
   * Spawn the frpc process and wait for it to report a successful connection
   * (or resolve optimistically after a timeout).
   */
  private async spawnProcess(configPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.binaryPath!, ["-c", configPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.process = proc;

      let startupOutput = "";
      let resolved = false;

      const onData = (data: Buffer) => {
        const text = data.toString();
        startupOutput += text;

        if (
          text.includes("start proxy success") ||
          text.includes("login to server success")
        ) {
          if (!resolved) {
            resolved = true;
            this.status = "connected";
            this.connectedSince = new Date();
            resolve();
          }
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
        // During a planned refresh cycle, don't update status
        if (this.refreshing) return;
        if (code !== 0 && !resolved) {
          this.status = "error";
          this.lastError = `frpc exited with code ${code}: ${startupOutput}`;
          resolved = true;
          reject(new Error(this.lastError));
        } else if (this.status === "connected") {
          this.status = "disconnected";
        }
      });

      // Timeout for startup — resolve optimistically
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.status = "connected";
          this.connectedSince = new Date();
          resolve();
        }
      }, 10_000);
    });
  }

  /**
   * Kill the running frpc process and wait for it to exit.
   */
  private async killProcess(): Promise<void> {
    if (!this.process) return;

    return new Promise((resolve) => {
      const proc = this.process!;

      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        this.process = null;
        resolve();
      }, 3000);

      proc.once("exit", () => {
        clearTimeout(timeout);
        this.process = null;
        resolve();
      });

      proc.kill("SIGTERM");
    });
  }

  private scheduleRefresh(): void {
    this.clearRefreshTimer();
    this.refreshTimer = setTimeout(
      () => void this.refreshClaim(),
      REFRESH_INTERVAL_MS,
    );
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Refresh the auth claim by rewriting frpc.toml and restarting the process.
   * On failure, retries after a shorter interval.
   */
  private async refreshClaim(): Promise<void> {
    if (!this.config || !this.binaryPath) return;

    const subdomain = this.config.walletAddress.toLowerCase();

    try {
      const configPath = await this.writeFreshConfig(subdomain);

      // Stop old process (suppress status change during restart)
      this.refreshing = true;
      await this.killProcess();
      this.refreshing = false;

      this.status = "starting";
      await this.spawnProcess(configPath);

      this.scheduleRefresh();
    } catch {
      this.refreshing = false;
      // Retry sooner on failure
      this.refreshTimer = setTimeout(
        () => void this.refreshClaim(),
        REFRESH_RETRY_MS,
      );
    }
  }
}
