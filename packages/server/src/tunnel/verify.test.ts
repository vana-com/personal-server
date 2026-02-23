import { describe, it, expect, vi } from "vitest";
import { buildTunnelUrl, verifyTunnelUrl } from "./verify.js";

describe("tunnel/verify", () => {
  describe("buildTunnelUrl", () => {
    it("lowercases the wallet address", () => {
      expect(buildTunnelUrl("0xAbCdEf1234567890")).toBe(
        "https://0xabcdef1234567890.server.vana.org",
      );
    });

    it("returns correct URL for already-lowercase address", () => {
      expect(buildTunnelUrl("0xabc123")).toBe(
        "https://0xabc123.server.vana.org",
      );
    });

    it("uses prod domain for frpc.server.vana.org", () => {
      expect(buildTunnelUrl("0xabc", "frpc.server.vana.org")).toBe(
        "https://0xabc.server.vana.org",
      );
    });

    it("uses dev domain for frpc.server-dev.vana.org", () => {
      expect(buildTunnelUrl("0xabc", "frpc.server-dev.vana.org")).toBe(
        "https://0xabc.server-dev.vana.org",
      );
    });

    it("falls back to default domain for unknown serverAddr", () => {
      expect(buildTunnelUrl("0xabc", "custom.example.com")).toBe(
        "https://0xabc.server.vana.org",
      );
    });
  });

  describe("verifyTunnelUrl", () => {
    const opts = { maxAttempts: 3, retryDelayMs: 0, timeoutMs: 1000 };

    it("returns reachable on first successful fetch", async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true });

      const result = await verifyTunnelUrl("https://example.server.vana.org", {
        ...opts,
        fetchFn,
      });

      expect(result).toEqual({ reachable: true, attempts: 1 });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn).toHaveBeenCalledWith(
        "https://example.server.vana.org/health",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("retries on failure and succeeds on later attempt", async () => {
      const fetchFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("connection refused"))
        .mockResolvedValueOnce({ ok: true });

      const result = await verifyTunnelUrl("https://example.server.vana.org", {
        ...opts,
        fetchFn,
      });

      expect(result).toEqual({ reachable: true, attempts: 2 });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("returns unreachable after exhausting retries", async () => {
      const fetchFn = vi
        .fn()
        .mockRejectedValue(new Error("connection refused"));

      const result = await verifyTunnelUrl("https://example.server.vana.org", {
        ...opts,
        fetchFn,
      });

      expect(result).toEqual({
        reachable: false,
        attempts: 3,
        error: "connection refused",
      });
      expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it("treats non-ok HTTP status as failure", async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 502 })
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await verifyTunnelUrl("https://example.server.vana.org", {
        ...opts,
        fetchFn,
      });

      expect(result).toEqual({
        reachable: false,
        attempts: 3,
        error: "HTTP 500",
      });
    });

    it("handles timeout errors", async () => {
      const fetchFn = vi
        .fn()
        .mockRejectedValue(
          new DOMException("signal timed out", "TimeoutError"),
        );

      const result = await verifyTunnelUrl("https://example.server.vana.org", {
        ...opts,
        fetchFn,
      });

      expect(result).toEqual({
        reachable: false,
        attempts: 3,
        error: "signal timed out",
      });
    });
  });
});
