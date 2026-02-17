/**
 * Generic process supervisor with exponential backoff.
 *
 * Restarts a child process on crash with configurable backoff:
 * - Base delay: 1 second
 * - Max delay: 60 seconds
 * - Jitter: 0-1 second (random)
 * - Max retries: 10 (then gives up and emits "max-retries" event)
 *
 * Resets retry count on successful runs (process alive > resetAfterMs).
 */

import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { EventEmitter } from "node:events";

export interface SupervisorOptions {
  /** Command to execute. */
  command: string;
  /** Arguments for the command. */
  args: string[];
  /** Spawn options (env, cwd, stdio, etc). */
  spawnOptions?: SpawnOptions;
  /** Base delay in ms before first retry. Default: 1000 */
  baseDelayMs?: number;
  /** Max delay in ms between retries. Default: 60000 */
  maxDelayMs?: number;
  /** Max jitter in ms added to delay. Default: 1000 */
  maxJitterMs?: number;
  /** Max consecutive retries before giving up. Default: 10 */
  maxRetries?: number;
  /** Time in ms after which a running process resets retry count. Default: 30000 */
  resetAfterMs?: number;
}

export interface SupervisorEvents {
  start: [pid: number];
  exit: [code: number | null, signal: string | null];
  restart: [attempt: number, delayMs: number];
  "max-retries": [];
  error: [error: Error];
}

export class Supervisor extends EventEmitter<SupervisorEvents> {
  private process: ChildProcess | null = null;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private startTime: number | null = null;
  private stopped = true;

  private readonly command: string;
  private readonly args: string[];
  private readonly spawnOptions: SpawnOptions;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxJitterMs: number;
  private readonly maxRetries: number;
  private readonly resetAfterMs: number;

  constructor(options: SupervisorOptions) {
    super();
    this.command = options.command;
    this.args = options.args;
    this.spawnOptions = options.spawnOptions ?? {};
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 60_000;
    this.maxJitterMs = options.maxJitterMs ?? 1_000;
    this.maxRetries = options.maxRetries ?? 10;
    this.resetAfterMs = options.resetAfterMs ?? 30_000;
  }

  /** Start the supervised process. */
  start(): ChildProcess {
    if (!this.stopped) {
      throw new Error("Supervisor already running");
    }

    this.stopped = false;
    this.retryCount = 0;
    return this.spawnChild();
  }

  /** Stop the supervised process. Does not restart. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearRetryTimer();

    if (!this.process) return;

    return new Promise((resolve) => {
      const proc = this.process!;

      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        this.process = null;
        resolve();
      }, 5_000);

      proc.once("exit", () => {
        clearTimeout(timeout);
        this.process = null;
        resolve();
      });

      proc.kill("SIGTERM");
    });
  }

  /** Get the current child process (if running). */
  getProcess(): ChildProcess | null {
    return this.process;
  }

  /** Whether the supervisor is actively managing a process. */
  isRunning(): boolean {
    return !this.stopped;
  }

  private spawnChild(): ChildProcess {
    const proc = spawn(this.command, this.args, this.spawnOptions);
    this.process = proc;
    this.startTime = Date.now();

    this.emit("start", proc.pid!);

    proc.on("error", (err) => {
      this.emit("error", err);
    });

    proc.on("exit", (code, signal) => {
      this.process = null;
      this.emit("exit", code, signal);

      if (this.stopped) return;

      // Reset retry count if process ran long enough
      if (this.startTime && Date.now() - this.startTime >= this.resetAfterMs) {
        this.retryCount = 0;
      }

      this.scheduleRestart();
    });

    return proc;
  }

  private scheduleRestart(): void {
    if (this.retryCount >= this.maxRetries) {
      this.stopped = true;
      this.emit("max-retries");
      return;
    }

    const delay = this.calculateDelay();
    this.retryCount++;

    this.emit("restart", this.retryCount, delay);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) {
        this.spawnChild();
      }
    }, delay);
  }

  /** Exponential backoff with jitter. */
  private calculateDelay(): number {
    const exponential = this.baseDelayMs * Math.pow(2, this.retryCount);
    const capped = Math.min(exponential, this.maxDelayMs);
    const jitter = Math.random() * this.maxJitterMs;
    return capped + jitter;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
