import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writePidFile,
  readPidFile,
  removePidFile,
  checkRunningServer,
  pidFilePath,
  type ServerMetadata,
} from "./pid.js";

describe("PID file management", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "pid-test-"));
    return tempDir;
  }

  const sampleMetadata: ServerMetadata = {
    pid: process.pid,
    port: 8080,
    socketPath: "/tmp/ipc.sock",
    version: "1.0.0",
    startedAt: "2026-01-01T00:00:00.000Z",
  };

  it("resolves PID file path", async () => {
    const root = await setup();
    expect(pidFilePath(root)).toBe(join(root, "server.json"));
  });

  it("writes and reads PID file", async () => {
    const root = await setup();
    await writePidFile(root, sampleMetadata);
    const read = await readPidFile(root);
    expect(read).toEqual(sampleMetadata);
  });

  it("returns null when PID file does not exist", async () => {
    const root = await setup();
    const result = await readPidFile(root);
    expect(result).toBeNull();
  });

  it("removes PID file", async () => {
    const root = await setup();
    await writePidFile(root, sampleMetadata);
    await removePidFile(root);
    const result = await readPidFile(root);
    expect(result).toBeNull();
  });

  it("removePidFile does not throw when file missing", async () => {
    const root = await setup();
    await expect(removePidFile(root)).resolves.toBeUndefined();
  });

  it("checkRunningServer returns metadata for current process", async () => {
    const root = await setup();
    await writePidFile(root, sampleMetadata);
    const result = await checkRunningServer(root);
    expect(result).toEqual(sampleMetadata);
  });

  it("checkRunningServer cleans up stale PID file for dead process", async () => {
    const root = await setup();
    const staleMeta: ServerMetadata = {
      ...sampleMetadata,
      pid: 999999, // Very likely not running
    };
    await writePidFile(root, staleMeta);
    const result = await checkRunningServer(root);
    expect(result).toBeNull();

    // PID file should be cleaned up
    const afterRead = await readPidFile(root);
    expect(afterRead).toBeNull();
  });
});
