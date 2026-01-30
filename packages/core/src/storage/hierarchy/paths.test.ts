import { describe, it, expect } from "vitest";
import {
  timestampToFilename,
  filenameToTimestamp,
  buildDataFilePath,
  buildScopeDir,
  generateCollectedAt,
} from "./paths.js";

describe("timestampToFilename", () => {
  it("replaces colons with hyphens", () => {
    expect(timestampToFilename("2026-01-21T10:00:00Z")).toBe(
      "2026-01-21T10-00-00Z",
    );
  });
});

describe("filenameToTimestamp", () => {
  it("replaces hyphens in time portion with colons", () => {
    expect(filenameToTimestamp("2026-01-21T10-00-00Z")).toBe(
      "2026-01-21T10:00:00Z",
    );
  });
});

describe("timestamp roundtrip", () => {
  it("filenameToTimestamp(timestampToFilename(ts)) equals ts", () => {
    const ts = "2026-01-21T10:00:00Z";
    expect(filenameToTimestamp(timestampToFilename(ts))).toBe(ts);
  });
});

describe("buildDataFilePath", () => {
  it("builds correct path for two-segment scope", () => {
    expect(
      buildDataFilePath("/data", "instagram.profile", "2026-01-21T10:00:00Z"),
    ).toBe("/data/instagram/profile/2026-01-21T10-00-00Z.json");
  });

  it("includes 3 directory segments for three-segment scope", () => {
    const path = buildDataFilePath(
      "/data",
      "chatgpt.conversations.shared",
      "2026-01-21T10:00:00Z",
    );
    expect(path).toBe(
      "/data/chatgpt/conversations/shared/2026-01-21T10-00-00Z.json",
    );
  });
});

describe("buildScopeDir", () => {
  it("builds correct directory path", () => {
    expect(buildScopeDir("/data", "instagram.profile")).toBe(
      "/data/instagram/profile",
    );
  });
});

describe("generateCollectedAt", () => {
  it("returns ISO 8601 without milliseconds ending in Z", () => {
    const result = generateCollectedAt();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
