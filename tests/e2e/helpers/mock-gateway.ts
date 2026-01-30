import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";

export interface MockGateway {
  url: string;
  cleanup: () => Promise<void>;
}

export async function startMockGateway(): Promise<MockGateway> {
  const app = new Hono();

  app.get("/v1/schemas", (c) => {
    const scope = c.req.query("scope") ?? "unknown";
    return c.json({
      schemaId: "test-schema",
      scope,
      url: "https://test-schema.example.com",
    });
  });

  app.get("/v1/builders/:address", (c) => {
    return c.json({
      address: c.req.param("address"),
      name: "Test Builder",
      registered: true,
    });
  });

  app.get("/v1/grants/:grantId", (c) => {
    return c.json({ error: "not found" }, 404);
  });

  app.get("/v1/grants", (c) => {
    return c.json([]);
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
