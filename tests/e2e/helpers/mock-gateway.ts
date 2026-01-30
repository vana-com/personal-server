import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";

export interface MockGateway {
  url: string;
  cleanup: () => Promise<void>;
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

export async function startMockGateway(): Promise<MockGateway> {
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
