import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { startTestServer, type TestServer } from "./helpers/server.js";
import { startMockGateway, type MockGateway } from "./helpers/mock-gateway.js";
import { loadOrCreateServerAccount } from "../../packages/core/src/keys/server-account.js";
import {
  serverRegistrationDomain,
  SERVER_REGISTRATION_TYPES,
  type ServerRegistrationMessage,
} from "../../packages/core/src/signing/index.js";
import { DEFAULTS } from "../../packages/core/src/schemas/server-config.js";

const KNOWN_SIG =
  "0xedbb7743cce459345238442dcfb291f234a321d253485eaa58251aa0f28ea8f1410ab988bae2657b689cd24417b41e315efc22ba333024f4a6269c424ded8d361b";

describe("Delegation (e2e)", () => {
  describe("unregistered server", () => {
    let server: TestServer;
    let gateway: MockGateway;

    beforeAll(async () => {
      // Mock gateway returns 404 for all server lookups (no pre-registered servers)
      gateway = await startMockGateway();
      server = await startTestServer({
        gatewayUrl: gateway.url,
        masterKeySignature: KNOWN_SIG,
        // No gatewayConfig needed — delegation works with just master key
      });
    });

    afterAll(async () => {
      await server.cleanup();
      await gateway.cleanup();
    });

    it("health shows identity info with address and serverId=null", async () => {
      const res = await fetch(`${server.url}/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.identity).not.toBeNull();
      expect(body.identity.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(body.identity.publicKey).toMatch(/^0x04/);
      expect(body.identity.serverId).toBeNull();
    });

    it("health shows owner address", async () => {
      const res = await fetch(`${server.url}/health`);
      const body = await res.json();
      expect(body.owner).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });
  });

  describe("registered server", () => {
    let server: TestServer;
    let gateway: MockGateway;
    let serverDir: string;

    beforeAll(async () => {
      // Pre-create a key file so we know the server address before starting
      serverDir = await mkdtemp(join(tmpdir(), "e2e-delegation-"));
      const keyPath = join(serverDir, "key.json");
      const account = loadOrCreateServerAccount(keyPath);

      gateway = await startMockGateway({
        registeredServers: new Set([account.address]),
      });
      server = await startTestServer({
        gatewayUrl: gateway.url,
        masterKeySignature: KNOWN_SIG,
        serverDir,
      });
    });

    afterAll(async () => {
      await server.cleanup();
      await gateway.cleanup();
      await rm(serverDir, { recursive: true, force: true });
    });

    it("health shows identity.serverId as non-null string when server is pre-registered", async () => {
      const res = await fetch(`${server.url}/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.identity).not.toBeNull();
      expect(typeof body.identity.serverId).toBe("string");
      expect(body.identity.serverId).not.toBeNull();
    });
  });

  describe("server registration via POST /v1/servers", () => {
    let gateway: MockGateway;
    let server: TestServer;
    let serverDir: string;

    beforeAll(async () => {
      serverDir = await mkdtemp(join(tmpdir(), "e2e-register-"));
      // Start gateway with NO pre-registered servers
      gateway = await startMockGateway();
    });

    afterAll(async () => {
      await server?.cleanup();
      await gateway.cleanup();
      await rm(serverDir, { recursive: true, force: true });
    });

    it("registers a server and shows serverId as non-null after restart", async () => {
      const keyPath = join(serverDir, "key.json");
      const serverAccount = loadOrCreateServerAccount(keyPath);

      // Generate an owner key and sign a ServerRegistration message
      const ownerKey = generatePrivateKey();
      const ownerAccount = privateKeyToAccount(ownerKey);

      const gatewayConfig = {
        chainId: DEFAULTS.gateway.chainId,
        contracts: DEFAULTS.gateway.contracts,
      };

      const message: ServerRegistrationMessage = {
        ownerAddress: ownerAccount.address,
        serverAddress: serverAccount.address,
        publicKey: serverAccount.publicKey,
        serverUrl: "http://localhost:9999",
      };

      const domain = serverRegistrationDomain(gatewayConfig);

      const signature = await ownerAccount.signTypedData({
        domain: domain as Parameters<
          typeof ownerAccount.signTypedData
        >[0]["domain"],
        types: SERVER_REGISTRATION_TYPES,
        primaryType: "ServerRegistration",
        message,
      });

      // POST to mock gateway
      const res = await fetch(`${gateway.url}/v1/servers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Web3Signed ${signature}`,
        },
        body: JSON.stringify(message),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.serverAddress).toBe(serverAccount.address);

      // Now start a server pointing at this gateway — it should see serverId as non-null
      server = await startTestServer({
        gatewayUrl: gateway.url,
        masterKeySignature: KNOWN_SIG,
        serverDir,
      });

      const healthRes = await fetch(`${server.url}/health`);
      const health = await healthRes.json();
      expect(typeof health.identity.serverId).toBe("string");
      expect(health.identity.serverId).not.toBeNull();
    });

    it("returns 409 for duplicate registration", async () => {
      const keyPath = join(serverDir, "key.json");
      const serverAccount = loadOrCreateServerAccount(keyPath);

      const ownerKey = generatePrivateKey();
      const ownerAccount = privateKeyToAccount(ownerKey);

      const message: ServerRegistrationMessage = {
        ownerAddress: ownerAccount.address,
        serverAddress: serverAccount.address,
        publicKey: serverAccount.publicKey,
        serverUrl: "http://localhost:9999",
      };

      const gatewayConfig = {
        chainId: DEFAULTS.gateway.chainId,
        contracts: DEFAULTS.gateway.contracts,
      };

      const domain = serverRegistrationDomain(gatewayConfig);

      const signature = await ownerAccount.signTypedData({
        domain: domain as Parameters<
          typeof ownerAccount.signTypedData
        >[0]["domain"],
        types: SERVER_REGISTRATION_TYPES,
        primaryType: "ServerRegistration",
        message,
      });

      const res = await fetch(`${gateway.url}/v1/servers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Web3Signed ${signature}`,
        },
        body: JSON.stringify(message),
      });
      expect(res.status).toBe(409);
    });
  });

  describe("no identity config", () => {
    let server: TestServer;
    let gateway: MockGateway;

    beforeAll(async () => {
      gateway = await startMockGateway();
      server = await startTestServer({
        gatewayUrl: gateway.url,
        // No masterKeySignature
      });
    });

    afterAll(async () => {
      await server.cleanup();
      await gateway.cleanup();
    });

    it("health shows identity: null without master key", async () => {
      const res = await fetch(`${server.url}/health`);
      const body = await res.json();
      expect(body.identity).toBeNull();
    });
  });
});
