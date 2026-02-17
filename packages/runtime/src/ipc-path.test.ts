import { describe, it, expect } from "vitest";
import { resolveSocketPath } from "./ipc-path.js";

describe("resolveSocketPath", () => {
  it("returns path within storage root for short paths", () => {
    const result = resolveSocketPath("/tmp/ps");
    expect(result).toBe("/tmp/ps/ipc.sock");
  });

  it("falls back to /tmp for paths exceeding 100 bytes", () => {
    // Create a very long path that exceeds the macOS 103-byte limit
    const longRoot = "/" + "a".repeat(100);
    const result = resolveSocketPath(longRoot);
    expect(result).toMatch(/^\/tmp\/vana-ps-[a-f0-9]{12}\.sock$/);
  });

  it("produces deterministic fallback paths for same input", () => {
    const longRoot = "/" + "b".repeat(100);
    const path1 = resolveSocketPath(longRoot);
    const path2 = resolveSocketPath(longRoot);
    expect(path1).toBe(path2);
  });

  it("produces different fallback paths for different inputs", () => {
    const root1 = "/" + "c".repeat(100);
    const root2 = "/" + "d".repeat(100);
    expect(resolveSocketPath(root1)).not.toBe(resolveSocketPath(root2));
  });
});
