import { describe, it, expect, afterEach } from "vitest";
import { Supervisor } from "./supervisor.js";

describe("Supervisor", () => {
  let supervisor: Supervisor | null = null;

  afterEach(async () => {
    if (supervisor) {
      await supervisor.stop();
      supervisor = null;
    }
  });

  it("starts a child process and emits start event", async () => {
    supervisor = new Supervisor({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
    });

    const started = new Promise<number>((resolve) => {
      supervisor!.on("start", resolve);
    });

    supervisor.start();
    const pid = await started;
    expect(pid).toBeGreaterThan(0);
    expect(supervisor.isRunning()).toBe(true);
  });

  it("stops the child process", async () => {
    supervisor = new Supervisor({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
    });

    // Register listener before starting
    const started = new Promise<void>((resolve) => {
      supervisor!.on("start", () => resolve());
    });
    supervisor.start();
    await started;

    await supervisor.stop();
    expect(supervisor.getProcess()).toBeNull();
    expect(supervisor.isRunning()).toBe(false);
  });

  it("restarts on process exit with backoff", async () => {
    supervisor = new Supervisor({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      baseDelayMs: 50,
      maxDelayMs: 200,
      maxJitterMs: 0, // Disable jitter for deterministic tests
      maxRetries: 2,
    });

    const restarts: number[] = [];
    supervisor.on("restart", (attempt) => restarts.push(attempt));

    const maxRetried = new Promise<void>((resolve) => {
      supervisor!.on("max-retries", resolve);
    });

    supervisor.start();
    await maxRetried;

    expect(restarts).toEqual([1, 2]);
    expect(supervisor.isRunning()).toBe(false);
  });

  it("emits exit event with code", async () => {
    supervisor = new Supervisor({
      command: process.execPath,
      args: ["-e", "process.exit(42)"],
      maxRetries: 0,
    });

    const exitPromise = new Promise<[number | null, string | null]>(
      (resolve) => {
        supervisor!.on("exit", (code, signal) => resolve([code, signal]));
      },
    );

    supervisor.start();
    const [code] = await exitPromise;
    expect(code).toBe(42);
  });

  it("throws when starting while already running", async () => {
    supervisor = new Supervisor({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
    });

    const started = new Promise<void>((r) => {
      supervisor!.on("start", () => r());
    });
    supervisor.start();
    await started;

    expect(() => supervisor!.start()).toThrow("Supervisor already running");
  });

  it("calculates exponential backoff delay", async () => {
    supervisor = new Supervisor({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      baseDelayMs: 100,
      maxDelayMs: 1000,
      maxJitterMs: 0,
      maxRetries: 3,
    });

    const delays: number[] = [];
    supervisor.on("restart", (_attempt, delay) => delays.push(delay));

    const maxRetried = new Promise<void>((resolve) => {
      supervisor!.on("max-retries", resolve);
    });

    supervisor.start();
    await maxRetried;

    // Exponential: 100 * 2^0 = 100, 100 * 2^1 = 200, 100 * 2^2 = 400
    expect(delays).toEqual([100, 200, 400]);
  });

  it("caps delay at maxDelayMs", async () => {
    supervisor = new Supervisor({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      baseDelayMs: 100,
      maxDelayMs: 150,
      maxJitterMs: 0,
      maxRetries: 3,
    });

    const delays: number[] = [];
    supervisor.on("restart", (_attempt, delay) => delays.push(delay));

    const maxRetried = new Promise<void>((resolve) => {
      supervisor!.on("max-retries", resolve);
    });

    supervisor.start();
    await maxRetried;

    // 100, 150 (capped from 200), 150 (capped from 400)
    expect(delays).toEqual([100, 150, 150]);
  });
});
