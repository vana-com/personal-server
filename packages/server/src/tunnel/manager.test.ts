import { describe, it, expect, beforeEach } from "vitest";
import { TunnelManager } from "./manager.js";

describe("tunnel/manager", () => {
  describe("TunnelManager", () => {
    let manager: TunnelManager;

    beforeEach(() => {
      manager = new TunnelManager("/tmp/test-tunnel");
    });

    it("initial status is stopped", () => {
      const status = manager.getStatus();
      expect(status.status).toBe("stopped");
      expect(status.enabled).toBe(true);
      expect(status.publicUrl).toBeNull();
      expect(status.connectedSince).toBeNull();
    });

    it("isRunning returns false when stopped", () => {
      expect(manager.isRunning()).toBe(false);
    });

    it("getPublicUrl returns null when not connected", () => {
      expect(manager.getPublicUrl()).toBeNull();
    });

    it("stop() is safe to call when already stopped", async () => {
      await expect(manager.stop()).resolves.toBeUndefined();
    });
  });
});
