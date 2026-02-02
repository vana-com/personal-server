import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";

export interface MockGateway {
  url: string;
  cleanup: () => Promise<void>;
}

export interface MockGatewayOptions {
  /** Server addresses that should be treated as registered. */
  registeredServers?: Set<string>;
}

function wrapEnvelope<T>(data: T) {
  return {
    data,
    proof: {
      signature: "0xmockproof",
      timestamp: new Date().toISOString(),
      gatewayAddress: "0xMockGateway",
      requestHash: "0xreqhash",
      responseHash: "0xreshash",
      userSignature: "0xusersig",
      status: "confirmed",
      chainBlockHeight: 1000,
    },
  };
}

export async function startMockGateway(
  options?: MockGatewayOptions,
): Promise<MockGateway> {
  const registeredServers = options?.registeredServers ?? new Set<string>();
  const app = new Hono();

  app.get("/v1/schemas", (c) => {
    const scope = c.req.query("scope") ?? "unknown";
    return c.json(
      wrapEnvelope({
        id: "0xschema1",
        ownerAddress: "0xSchemaOwner",
        name: scope,
        definitionUrl: "https://test-schema.example.com",
        scope,
        addedAt: "2026-01-21T10:00:00.000Z",
      }),
    );
  });

  app.get("/v1/builders/:address", (c) => {
    return c.json(
      wrapEnvelope({
        id: "0xbuilder1",
        ownerAddress: "0xBuilderOwner",
        granteeAddress: c.req.param("address"),
        publicKey: "0x04mockkey",
        appUrl: "https://builder.example.com",
        addedAt: "2026-01-21T10:00:00.000Z",
      }),
    );
  });

  app.get("/v1/grants/:grantId", (c) => {
    return c.json({ error: "not found" }, 404);
  });

  app.get("/v1/grants", (c) => {
    return c.json(wrapEnvelope([]));
  });

  // Server lookup — returns 200 if address is in registeredServers, 404 otherwise
  app.get("/v1/servers/:address", (c) => {
    const addr = c.req.param("address").toLowerCase();
    const isRegistered = [...registeredServers].some(
      (s) => s.toLowerCase() === addr,
    );
    if (!isRegistered) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(
      wrapEnvelope({
        id: "0xserver1",
        ownerAddress: "0xServerOwner",
        serverAddress: c.req.param("address"),
        publicKey: "0x04serverpubkey",
        serverUrl: "https://server.example.com",
        addedAt: "2026-01-21T10:00:00.000Z",
      }),
    );
  });

  // Server registration
  app.post("/v1/servers", async (c) => {
    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Web3Signed ")) {
      return c.json({ error: "Missing authorization" }, 401);
    }
    const body = await c.req.json();
    const addr = (body.serverAddress as string)?.toLowerCase();
    if ([...registeredServers].some((s) => s.toLowerCase() === addr)) {
      return c.json({ error: "already registered" }, 409);
    }
    registeredServers.add(body.serverAddress as string);
    return c.json(
      wrapEnvelope({
        id: "mock-server-id",
        ...body,
        addedAt: new Date().toISOString(),
      }),
    );
  });

  // File registration
  app.post("/v1/files", async (c) => {
    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Web3Signed ")) {
      return c.json({ error: "Missing authorization" }, 401);
    }
    const body = await c.req.json();
    return c.json({ fileId: "mock-file-id", ...body });
  });

  // Grant creation
  app.post("/v1/grants", async (c) => {
    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Web3Signed ")) {
      return c.json({ error: "Missing authorization" }, 401);
    }
    const body = await c.req.json();
    return c.json({ grantId: "mock-grant-id", ...body });
  });

  // Grant revocation
  app.post("/v1/grants/:grantId/revoke", async (c) => {
    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Web3Signed ")) {
      return c.json({ error: "Missing authorization" }, 401);
    }
    return c.json({});
  });

  const server: ServerType = serve({
    fetch: app.fetch,
    port: 0,
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get mock gateway address");
  }
  const url = `http://localhost:${(address as AddressInfo).port}`;

  return {
    url,
    cleanup: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
