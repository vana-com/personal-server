import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { vi } from "vitest";
import { ServerConfigSchema } from "../../../packages/core/src/schemas/server-config.js";
import type { GatewayConfig } from "../../../packages/core/src/schemas/server-config.js";
import { createServer } from "../../../packages/server/src/bootstrap.js";

export interface TestServer {
  url: string;
  cleanup: () => Promise<void>;
}

export async function startTestServer(options?: {
  gatewayUrl?: string;
  masterKeySignature?: string;
  gatewayConfig?: GatewayConfig;
  /** Use a specific port instead of a random one. */
  fixedPort?: number;
  /** Use a pre-existing server directory instead of creating a temp one. */
  serverDir?: string;
}): Promise<TestServer> {
  const serverDir =
    options?.serverDir ?? (await mkdtemp(join(tmpdir(), "e2e-server-")));
  const dataDir = join(serverDir, "data");

  let port: number;
  if (options?.fixedPort) {
    port = options.fixedPort;
  } else {
    const tempServer: ServerType = serve({ fetch: new Hono().fetch, port: 0 });
    const tempAddr = tempServer.address();
    if (!tempAddr || typeof tempAddr === "string") {
      throw new Error("Failed to get temporary server address");
    }
    port = (tempAddr as AddressInfo).port;
    await new Promise<void>((resolve, reject) => {
      tempServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

  if (options?.masterKeySignature) {
    vi.stubEnv("VANA_MASTER_KEY_SIGNATURE", options.masterKeySignature);
  }

  const gateway: Record<string, unknown> = {
    url: options?.gatewayUrl ?? "http://localhost:9999",
  };

  if (options?.gatewayConfig) {
    gateway.chainId = options.gatewayConfig.chainId;
    gateway.contracts = options.gatewayConfig.contracts;
  }

  const configInput: Record<string, unknown> = {
    server: { port, origin: `http://localhost:${port}` },
    gateway,
    logging: { level: "fatal" },
  };

  const config = ServerConfigSchema.parse(configInput);

  const context = await createServer(config, { serverDir, dataDir });

  const server: ServerType = serve({
    fetch: context.app.fetch,
    port,
  });

  const url = `http://localhost:${port}`;

  return {
    url,
    cleanup: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      context.cleanup();
      // Only remove serverDir if we created it (not externally provided)
      if (!options?.serverDir) {
        await rm(serverDir, { recursive: true, force: true });
      }
      vi.unstubAllEnvs();
    },
  };
}
