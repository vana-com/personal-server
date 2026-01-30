import { z } from "zod";

export const LoggingConfigSchema = z.object({
  level: z.enum(["fatal", "error", "warn", "info", "debug"]).default("info"),
  pretty: z.boolean().default(false),
});

export const StorageBackend = z.enum([
  "local",
  "vana",
  "ipfs",
  "gdrive",
  "dropbox",
]);

export const DevUiConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

export const ServerConfigSchema = z.object({
  server: z
    .object({
      port: z.number().int().min(1).max(65535).default(8080),
      address: z.string().optional(),
      origin: z.string().url().optional(),
    })
    .default({ port: 8080 }),
  gatewayUrl: z
    .string()
    .url()
    .default("https://data-gateway-env-dev-opendatalabs.vercel.app"),
  logging: LoggingConfigSchema.default({ level: "info", pretty: false }),
  storage: z
    .object({
      backend: StorageBackend.default("local"),
    })
    .default({ backend: "local" }),
  devUi: DevUiConfigSchema.default({ enabled: true }),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
