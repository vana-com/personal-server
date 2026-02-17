/**
 * Admin Hono app for IPC (Unix domain socket) transport.
 *
 * Mounts admin/owner routes WITHOUT auth middleware — socket file
 * permissions (chmod 0600) enforce the local trust boundary instead.
 *
 * During the migration period, both the HTTP app and this admin app
 * coexist. Once DataBridge switches to IPC, admin routes will be
 * removed from the HTTP app.
 */

import { Hono } from "hono";
import { ProtocolError } from "@opendatalabs/personal-server-ts-core/errors";
import { ScopeSchema } from "@opendatalabs/personal-server-ts-core/scopes";
import { createDataFileEnvelope } from "@opendatalabs/personal-server-ts-core/schemas/data-file";
import {
  generateCollectedAt,
  writeDataFile,
  deleteAllForScope,
} from "@opendatalabs/personal-server-ts-core/storage/hierarchy";
import type { HierarchyManagerOptions } from "@opendatalabs/personal-server-ts-core/storage/hierarchy";
import type { IndexManager } from "@opendatalabs/personal-server-ts-core/storage/index";
import type { GatewayClient } from "@opendatalabs/personal-server-ts-core/gateway";
import type { AccessLogReader } from "@opendatalabs/personal-server-ts-core/logging/access-reader";
import type { SyncManager } from "@opendatalabs/personal-server-ts-core/sync";
import type { ServerSigner } from "@opendatalabs/personal-server-ts-core/signing";
import type { Logger } from "pino";
import {
  createBodyLimit,
  DATA_INGEST_MAX_SIZE,
} from "./middleware/body-limit.js";

export interface AdminAppDeps {
  logger: Logger;
  indexManager: IndexManager;
  hierarchyOptions: HierarchyManagerOptions;
  gateway: GatewayClient;
  accessLogReader: AccessLogReader;
  serverOwner?: `0x${string}`;
  syncManager?: SyncManager | null;
  serverSigner?: ServerSigner;
}

export function createAdminApp(deps: AdminAppDeps): Hono {
  const app = new Hono();

  // --- Data ingest (POST /v1/data/:scope) ---
  app.use("/v1/data/:scope", createBodyLimit(DATA_INGEST_MAX_SIZE));

  app.post("/v1/data/:scope", async (c) => {
    const scopeParam = c.req.param("scope");
    const scopeResult = ScopeSchema.safeParse(scopeParam);
    if (!scopeResult.success) {
      return c.json(
        {
          error: "INVALID_SCOPE",
          message: scopeResult.error.issues[0].message,
        },
        400,
      );
    }
    const scope = scopeResult.data;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "INVALID_BODY", message: "Request body must be valid JSON" },
        400,
      );
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return c.json(
        {
          error: "INVALID_BODY",
          message: "Request body must be a JSON object",
        },
        400,
      );
    }

    let schemaUrl: string | undefined;
    try {
      const schema = await deps.gateway.getSchemaForScope(scope);
      if (!schema) {
        return c.json(
          {
            error: "NO_SCHEMA",
            message: `No schema registered for scope: ${scope}`,
          },
          400,
        );
      }
      schemaUrl = schema.definitionUrl;
    } catch (err) {
      deps.logger.error({ err, scope }, "Gateway schema lookup failed");
      return c.json(
        {
          error: "GATEWAY_ERROR",
          message: "Failed to look up schema for scope",
        },
        502,
      );
    }

    const collectedAt = generateCollectedAt();
    const envelope = createDataFileEnvelope(
      scope,
      collectedAt,
      body as Record<string, unknown>,
      schemaUrl,
    );

    const writeResult = await writeDataFile(deps.hierarchyOptions, envelope);

    deps.indexManager.insert({
      fileId: null,
      path: writeResult.relativePath,
      scope,
      collectedAt,
      sizeBytes: writeResult.sizeBytes,
    });

    deps.logger.info(
      { scope, collectedAt, path: writeResult.relativePath },
      "Data file ingested (IPC)",
    );

    let status: "stored" | "syncing" = "stored";
    if (deps.syncManager) {
      deps.syncManager.notifyNewData();
      status = "syncing";
    }

    return c.json({ scope, collectedAt, status }, 201);
  });

  // --- Data delete (DELETE /v1/data/:scope) ---
  app.delete("/v1/data/:scope", async (c) => {
    const scopeParam = c.req.param("scope");
    const scopeResult = ScopeSchema.safeParse(scopeParam);
    if (!scopeResult.success) {
      return c.json(
        {
          error: "INVALID_SCOPE",
          message: scopeResult.error.issues[0].message,
        },
        400,
      );
    }
    const scope = scopeResult.data;

    const deletedCount = deps.indexManager.deleteByScope(scope);
    await deleteAllForScope(deps.hierarchyOptions, scope);

    deps.logger.info({ scope, deletedCount }, "Scope deleted (IPC)");
    return c.body(null, 204);
  });

  // --- Grants (GET + POST /v1/grants) ---
  app.get("/v1/grants", async (c) => {
    if (!deps.serverOwner) {
      return c.json(
        {
          error: {
            code: 500,
            errorCode: "SERVER_NOT_CONFIGURED",
            message: "Server owner address not configured",
          },
        },
        500,
      );
    }
    const grants = await deps.gateway.listGrantsByUser(deps.serverOwner);
    return c.json({ grants });
  });

  app.post("/v1/grants", async (c) => {
    if (!deps.serverOwner) {
      return c.json(
        {
          error: {
            code: 500,
            errorCode: "SERVER_NOT_CONFIGURED",
            message: "Server owner not configured",
          },
        },
        500,
      );
    }
    if (!deps.serverSigner) {
      return c.json(
        {
          error: {
            code: 500,
            errorCode: "SERVER_SIGNER_NOT_CONFIGURED",
            message: "Server signer not configured",
          },
        },
        500,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "INVALID_BODY", message: "Invalid JSON body" },
        400,
      );
    }

    const b = body as Record<string, unknown>;
    if (
      !b ||
      typeof b.granteeAddress !== "string" ||
      !b.granteeAddress.startsWith("0x") ||
      !Array.isArray(b.scopes) ||
      b.scopes.length === 0
    ) {
      return c.json(
        {
          error: "INVALID_BODY",
          message:
            "Body must include granteeAddress (0x string) and scopes (non-empty string array)",
        },
        400,
      );
    }

    const { granteeAddress, scopes, expiresAt, nonce } = b as {
      granteeAddress: `0x${string}`;
      scopes: string[];
      expiresAt?: number;
      nonce?: number;
    };

    const builder = await deps.gateway.getBuilder(granteeAddress);
    if (!builder) {
      return c.json(
        {
          error: {
            code: 404,
            errorCode: "BUILDER_NOT_REGISTERED",
            message: `Builder ${granteeAddress} is not registered on-chain`,
          },
        },
        404,
      );
    }

    const grantPayload = JSON.stringify({
      user: deps.serverOwner,
      builder: granteeAddress,
      scopes,
      expiresAt: expiresAt ?? 0,
      nonce: nonce ?? Date.now(),
    });

    const signature = await deps.serverSigner.signGrantRegistration({
      grantorAddress: deps.serverOwner,
      granteeId: builder.id as `0x${string}`,
      grant: grantPayload,
      fileIds: [],
    });

    const result = await deps.gateway.createGrant({
      grantorAddress: deps.serverOwner,
      granteeId: builder.id,
      grant: grantPayload,
      fileIds: [],
      signature,
    });

    return c.json({ grantId: result.grantId }, 201);
  });

  // --- Grant revoke (DELETE /v1/grants/:grantId) ---
  app.delete("/v1/grants/:grantId", async (c) => {
    if (!deps.serverOwner) {
      return c.json(
        {
          error: {
            code: 500,
            errorCode: "SERVER_NOT_CONFIGURED",
            message: "Server owner not configured",
          },
        },
        500,
      );
    }
    if (!deps.serverSigner) {
      return c.json(
        {
          error: {
            code: 500,
            errorCode: "SERVER_SIGNER_NOT_CONFIGURED",
            message: "Server signer not configured",
          },
        },
        500,
      );
    }

    const grantId = c.req.param("grantId");
    if (!grantId || !grantId.startsWith("0x")) {
      return c.json(
        {
          error: "INVALID_GRANT_ID",
          message: "grantId must be a 0x-prefixed hex string",
        },
        400,
      );
    }

    const signature = await deps.serverSigner.signGrantRevocation({
      grantorAddress: deps.serverOwner,
      grantId: grantId as `0x${string}`,
    });

    await deps.gateway.revokeGrant({
      grantId,
      grantorAddress: deps.serverOwner,
      signature,
    });

    return c.json({ revoked: true });
  });

  // --- Access logs (GET /v1/access-logs) ---
  app.get("/v1/access-logs", async (c) => {
    const limitParam = c.req.query("limit");
    const offsetParam = c.req.query("offset");

    const limit = limitParam !== undefined ? parseInt(limitParam, 10) : 50;
    const offset = offsetParam !== undefined ? parseInt(offsetParam, 10) : 0;

    const result = await deps.accessLogReader.read({
      limit: Number.isNaN(limit) ? 50 : limit,
      offset: Number.isNaN(offset) ? 0 : offset,
    });

    return c.json(result);
  });

  // --- Sync (GET + POST /v1/sync) ---
  app.get("/v1/sync/status", async (c) => {
    if (!deps.syncManager) {
      return c.json({
        enabled: false,
        running: false,
        lastSync: null,
        lastProcessedTimestamp: null,
        pendingFiles: 0,
        errors: [],
      });
    }
    return c.json(deps.syncManager.getStatus());
  });

  app.post("/v1/sync/trigger", async (c) => {
    if (!deps.syncManager) {
      return c.json(
        { status: "disabled", message: "Sync is not enabled" },
        200,
      );
    }
    await deps.syncManager.trigger();
    return c.json({ status: "started", message: "Sync triggered" }, 202);
  });

  // --- Error handler ---
  app.onError((err, c) => {
    if (err instanceof ProtocolError) {
      deps.logger.warn({ err }, err.message);
      return c.json(err.toJSON(), err.code as 400 | 500);
    }

    deps.logger.error({ err }, "Unhandled error (admin)");
    return c.json(
      {
        error: {
          code: 500,
          errorCode: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      },
      500,
    );
  });

  app.notFound((c) => {
    return c.json(
      {
        error: {
          code: 404,
          errorCode: "NOT_FOUND",
          message: "Not found",
        },
      },
      404,
    );
  });

  return app;
}
