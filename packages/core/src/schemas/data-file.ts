import { z } from "zod";

export const DataFileEnvelopeSchema = z.object({
  $schema: z.string().url().optional(),
  version: z.literal("1.0"),
  scope: z.string(),
  collectedAt: z.string().datetime(),
  data: z.record(z.unknown()),
});

export type DataFileEnvelope = z.infer<typeof DataFileEnvelopeSchema>;

export function createDataFileEnvelope(
  scope: string,
  collectedAt: string,
  data: Record<string, unknown>,
  schemaUrl?: string,
): DataFileEnvelope {
  return {
    ...(schemaUrl !== undefined && { $schema: schemaUrl }),
    version: "1.0",
    scope,
    collectedAt,
    data,
  };
}

export const IngestResponseSchema = z.object({
  scope: z.string(),
  collectedAt: z.string().datetime(),
  status: z.enum(["stored", "syncing"]),
});

export type IngestResponse = z.infer<typeof IngestResponseSchema>;
