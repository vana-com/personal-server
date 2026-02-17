import { describe, it, expect } from "vitest";
import { generateFrpcConfig, deriveProxyName } from "./config.js";

describe("tunnel/config", () => {
  describe("generateFrpcConfig", () => {
    const defaultOptions = {
      serverAddr: "frpc.server.vana.org",
      serverPort: 7000,
      localPort: 8080,
      subdomain: "0xabcdef",
      walletAddress: "0xABCdef",
      ownerAddress: "0xOwner",
      runId: "run-123",
      authClaim: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      authSig: "0xsig123",
    };

    it("produces valid TOML format", () => {
      const config = generateFrpcConfig(defaultOptions);

      expect(config).toContain("serverAddr");
      expect(config).toContain("serverPort");
      expect(config).toContain("[[proxies]]");
      expect(config).toContain("metadatas.");
    });

    it("substitutes serverAddr correctly", () => {
      const config = generateFrpcConfig(defaultOptions);
      expect(config).toContain('serverAddr = "frpc.server.vana.org"');
    });

    it("substitutes serverPort correctly", () => {
      const config = generateFrpcConfig(defaultOptions);
      expect(config).toContain("serverPort = 7000");
    });

    it("sets loginFailExit = false for resilience", () => {
      const config = generateFrpcConfig(defaultOptions);
      expect(config).toContain("loginFailExit = false");
    });

    it("configures HTTP proxy type", () => {
      const config = generateFrpcConfig(defaultOptions);
      expect(config).toContain('type = "http"');
    });

    it("sets localPort correctly", () => {
      const config = generateFrpcConfig(defaultOptions);
      expect(config).toContain("localPort = 8080");
    });

    it("sets subdomain correctly", () => {
      const config = generateFrpcConfig(defaultOptions);
      expect(config).toContain('subdomain = "0xabcdef"');
    });

    it("includes all metadata fields", () => {
      const config = generateFrpcConfig(defaultOptions);

      expect(config).toContain('wallet = "0xABCdef"');
      expect(config).toContain('owner = "0xOwner"');
      expect(config).toContain('run_id = "run-123"');
      expect(config).toContain(
        'auth_claim = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"',
      );
      expect(config).toContain('auth_sig = "0xsig123"');
    });

    it("uses custom server address and port", () => {
      const config = generateFrpcConfig({
        ...defaultOptions,
        serverAddr: "custom.frp.server",
        serverPort: 9000,
      });

      expect(config).toContain('serverAddr = "custom.frp.server"');
      expect(config).toContain("serverPort = 9000");
    });

    it("uses custom local port", () => {
      const config = generateFrpcConfig({
        ...defaultOptions,
        localPort: 3000,
      });

      expect(config).toContain("localPort = 3000");
    });

    it("uses unique proxy name derived from runId", () => {
      const config = generateFrpcConfig(defaultOptions);
      expect(config).toContain('name = "ps-run-123"');
      expect(config).not.toContain('name = "personal-server"');
    });

    it("includes x-ps-transport tunnel header in proxy config", () => {
      const config = generateFrpcConfig(defaultOptions);
      expect(config).toContain('x-ps-transport = "tunnel"');
      expect(config).toContain("[proxies.requestHeaders.set]");
    });
  });

  describe("deriveProxyName", () => {
    it("prefixes with ps- and takes first 8 chars of runId", () => {
      expect(deriveProxyName("abcdef12-3456-7890")).toBe("ps-abcdef12");
    });

    it("handles short runIds", () => {
      expect(deriveProxyName("abc")).toBe("ps-abc");
    });

    it("handles UUID format", () => {
      expect(deriveProxyName("a1b2c3d4-e5f6-7890-abcd-ef0123456789")).toBe(
        "ps-a1b2c3d4",
      );
    });
  });
});
