import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAccessLogWriter, type AccessLogEntry } from "./access-log.js";

function makeEntry(overrides: Partial<AccessLogEntry> = {}): AccessLogEntry {
  return {
    logId: "test-log-id",
    grantId: "test-grant-id",
    builder: "0x1234567890abcdef1234567890abcdef12345678",
    action: "read",
    scope: "instagram.profile",
    timestamp: "2026-01-28T12:00:00Z",
    ipAddress: "127.0.0.1",
    userAgent: "TestAgent/1.0",
    ...overrides,
  };
}

describe("AccessLogWriter", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "access-log-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("write() creates log file in correct directory", async () => {
    const logsDir = join(tempDir, "logs");
    const writer = createAccessLogWriter(logsDir);

    await writer.write(makeEntry());

    const files = await readdir(logsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^access-.*\.log$/);
  });

  it("log file name follows access-{YYYY-MM-DD}.log pattern", async () => {
    const logsDir = join(tempDir, "logs");
    const writer = createAccessLogWriter(logsDir);

    await writer.write(makeEntry({ timestamp: "2026-01-28T12:00:00Z" }));

    const files = await readdir(logsDir);
    expect(files[0]).toBe("access-2026-01-28.log");
  });

  it("file content is valid JSON line", async () => {
    const logsDir = join(tempDir, "logs");
    const writer = createAccessLogWriter(logsDir);

    const entry = makeEntry();
    await writer.write(entry);

    const content = await readFile(
      join(logsDir, "access-2026-01-28.log"),
      "utf-8",
    );
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.logId).toBe("test-log-id");
    expect(parsed.grantId).toBe("test-grant-id");
    expect(parsed.builder).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(parsed.action).toBe("read");
    expect(parsed.scope).toBe("instagram.profile");
    expect(parsed.timestamp).toBe("2026-01-28T12:00:00Z");
    expect(parsed.ipAddress).toBe("127.0.0.1");
    expect(parsed.userAgent).toBe("TestAgent/1.0");
  });

  it("two writes same day produce same file with 2 lines", async () => {
    const logsDir = join(tempDir, "logs");
    const writer = createAccessLogWriter(logsDir);

    await writer.write(
      makeEntry({ logId: "log-1", timestamp: "2026-01-28T10:00:00Z" }),
    );
    await writer.write(
      makeEntry({ logId: "log-2", timestamp: "2026-01-28T22:00:00Z" }),
    );

    const files = await readdir(logsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("access-2026-01-28.log");

    const content = await readFile(join(logsDir, files[0]), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    expect(JSON.parse(lines[0]).logId).toBe("log-1");
    expect(JSON.parse(lines[1]).logId).toBe("log-2");
  });

  it("writes to different days produce separate files", async () => {
    const logsDir = join(tempDir, "logs");
    const writer = createAccessLogWriter(logsDir);

    await writer.write(
      makeEntry({ logId: "day1", timestamp: "2026-01-28T12:00:00Z" }),
    );
    await writer.write(
      makeEntry({ logId: "day2", timestamp: "2026-01-29T12:00:00Z" }),
    );

    const files = (await readdir(logsDir)).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toBe("access-2026-01-28.log");
    expect(files[1]).toBe("access-2026-01-29.log");

    const content1 = await readFile(join(logsDir, files[0]), "utf-8");
    expect(JSON.parse(content1.trim()).logId).toBe("day1");

    const content2 = await readFile(join(logsDir, files[1]), "utf-8");
    expect(JSON.parse(content2.trim()).logId).toBe("day2");
  });
});
