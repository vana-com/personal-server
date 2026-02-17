import { z } from "zod";

export const DEFAULTS = {
  server: {
    port: 8080,
    origin: "http://localhost:8080",
  },
  logging: {
    level: "info" as const,
    pretty: false,
  },
  storage: {
    backend: "local" as const,
    config: {
      vana: {
        apiUrl: "https://storage.vana.com",
      },
    },
  },
  gateway: {
    url: "https://data-gateway-env-dev-opendatalabs.vercel.app",
    chainId: 14800,
    contracts: {
      dataRegistry: "0x8C8788f98385F6ba1adD4234e551ABba0f82Cb7C",
      dataPortabilityPermissions: "0xD54523048AdD05b4d734aFaE7C68324Ebb7373eF",
      dataPortabilityServer: "0x1483B1F634DBA75AeaE60da7f01A679aabd5ee2c",
      dataPortabilityGrantees: "0x8325C0A0948483EdA023A1A2Fd895e62C5131234",
    },
  },
  devUi: {
    enabled: true,
  },
  sync: {
    enabled: false,
    lastProcessedTimestamp: null,
  },
  tunnel: {
    enabled: true,
    serverAddr: "frpc.server.vana.org",
    serverPort: 7000,
  },
};

export const StorageBackend = z.enum([
  "local",
  "vana",
  "ipfs",
  "gdrive",
  "dropbox",
]);

export const VanaStorageConfigSchema = z.object({
  apiUrl: z.url().default(DEFAULTS.storage.config.vana.apiUrl),
});

export const ServerConfigSchema = z.object({
  server: z
    .object({
      port: z.number().int().min(1).max(65535).default(DEFAULTS.server.port),
      origin: z.url().default(DEFAULTS.server.origin),
      address: z
        .string()
        .startsWith("0x")
        .optional()
        .describe("Owner wallet address (set by DataBridge wrapper)"),
    })
    .default(DEFAULTS.server),
  logging: z
    .object({
      level: z
        .enum(["fatal", "error", "warn", "info", "debug"])
        .default(DEFAULTS.logging.level),
      pretty: z.boolean().default(DEFAULTS.logging.pretty),
    })
    .default(DEFAULTS.logging),
  storage: z
    .object({
      backend: StorageBackend.default(DEFAULTS.storage.backend),
      config: z
        .object({
          vana: VanaStorageConfigSchema.optional(),
        })
        .default({}),
    })
    .default(DEFAULTS.storage),
  gateway: z
    .object({
      url: z.url().default(DEFAULTS.gateway.url),
      chainId: z.number().int().positive().default(DEFAULTS.gateway.chainId),
      contracts: z
        .object({
          dataRegistry: z
            .string()
            .startsWith("0x")
            .default(DEFAULTS.gateway.contracts.dataRegistry),
          dataPortabilityPermissions: z
            .string()
            .startsWith("0x")
            .default(DEFAULTS.gateway.contracts.dataPortabilityPermissions),
          dataPortabilityServer: z
            .string()
            .startsWith("0x")
            .default(DEFAULTS.gateway.contracts.dataPortabilityServer),
          dataPortabilityGrantees: z
            .string()
            .startsWith("0x")
            .default(DEFAULTS.gateway.contracts.dataPortabilityGrantees),
        })
        .default(DEFAULTS.gateway.contracts),
    })
    .default(DEFAULTS.gateway),
  devUi: z
    .object({
      enabled: z.boolean().default(DEFAULTS.devUi.enabled),
    })
    .default(DEFAULTS.devUi),
  sync: z
    .object({
      enabled: z.boolean().default(DEFAULTS.sync.enabled),
      lastProcessedTimestamp: z
        .string()
        .datetime()
        .nullable()
        .default(DEFAULTS.sync.lastProcessedTimestamp),
    })
    .default(DEFAULTS.sync),
  tunnel: z
    .object({
      enabled: z.boolean().default(DEFAULTS.tunnel.enabled),
      serverAddr: z.string().default(DEFAULTS.tunnel.serverAddr),
      serverPort: z
        .number()
        .int()
        .min(1)
        .max(65535)
        .default(DEFAULTS.tunnel.serverPort),
    })
    .default(DEFAULTS.tunnel),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type LoggingConfig = ServerConfig["logging"];

/** Chain + contract config needed for EIP-712 signing. */
export type GatewayConfig = {
  chainId: number;
  contracts: {
    dataRegistry: string;
    dataPortabilityPermissions: string;
    dataPortabilityServer: string;
    dataPortabilityGrantees: string;
  };
};
