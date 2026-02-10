import { Hono } from "hono";
import { ScopeSchema } from "@opendatalabs/personal-server-ts-core/scopes";
import { createDataFileEnvelope } from "@opendatalabs/personal-server-ts-core/schemas/data-file";
import {
  generateCollectedAt,
  writeDataFile,
  readDataFile,
  deleteAllForScope,
} from "@opendatalabs/personal-server-ts-core/storage/hierarchy";
import type { HierarchyManagerOptions } from "@opendatalabs/personal-server-ts-core/storage/hierarchy";
import type { IndexManager } from "@opendatalabs/personal-server-ts-core/storage/index";
import type { GatewayClient } from "@opendatalabs/personal-server-ts-core/gateway";
import type { AccessLogWriter } from "@opendatalabs/personal-server-ts-core/logging/access-log";
import type { SyncManager } from "@opendatalabs/personal-server-ts-core/sync";
import type { Logger } from "pino";
import {
  createBodyLimit,
  DATA_INGEST_MAX_SIZE,
} from "../middleware/body-limit.js";
import { createWeb3AuthMiddleware } from "../middleware/web3-auth.js";
import { createBuilderCheckMiddleware } from "../middleware/builder-check.js";
import { createGrantCheckMiddleware } from "../middleware/grant-check.js";
import { createAccessLogMiddleware } from "../middleware/access-log.js";
import { createOwnerCheckMiddleware } from "../middleware/owner-check.js";

export interface DataRouteDeps {
  indexManager: IndexManager;
  hierarchyOptions: HierarchyManagerOptions;
  logger: Logger;
  serverOrigin: string | (() => string);
  serverOwner?: `0x${string}`;
  gateway: GatewayClient;
  accessLogWriter: AccessLogWriter;
  syncManager?: SyncManager | null;
  devToken?: string;
}

export function dataRoutes(deps: DataRouteDeps): Hono {
  const app = new Hono();

  // Create middleware instances
  const web3Auth = createWeb3AuthMiddleware({
    serverOrigin: deps.serverOrigin,
    devToken: deps.devToken,
    serverOwner: deps.serverOwner,
  });
  const builderCheck = createBuilderCheckMiddleware(deps.gateway);
  const grantCheck = createGrantCheckMiddleware({
    gateway: deps.gateway,
    serverOwner: deps.serverOwner,
  });
  const accessLog = createAccessLogMiddleware(deps.accessLogWriter);

  // GET /v1/data/:scope/versions — list versions for a scope (requires auth + builder, no grant)
  app.get("/:scope/versions", web3Auth, builderCheck, async (c) => {
    // 1. Validate scope
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

    // 2. Parse pagination
    const limit = c.req.query("limit")
      ? parseInt(c.req.query("limit")!, 10)
      : 20;
    const offset = c.req.query("offset")
      ? parseInt(c.req.query("offset")!, 10)
      : 0;

    // 3. Query index
    const entries = deps.indexManager.findByScope({ scope, limit, offset });
    const total = deps.indexManager.countByScope(scope);

    // 4. Return response
    return c.json({
      scope,
      versions: entries.map((e) => ({
        fileId: e.fileId,
        collectedAt: e.collectedAt,
      })),
      total,
      limit,
      offset,
    });
  });

  // GET /v1/data — list distinct scopes (requires auth + builder, no grant)
  app.get("/", web3Auth, builderCheck, async (c) => {
    const scopePrefix = c.req.query("scopePrefix");
    const limit = c.req.query("limit")
      ? parseInt(c.req.query("limit")!, 10)
      : 20;
    const offset = c.req.query("offset")
      ? parseInt(c.req.query("offset")!, 10)
      : 0;

    const result = deps.indexManager.listDistinctScopes({
      scopePrefix: scopePrefix || undefined,
      limit,
      offset,
    });

    return c.json({
      scopes: result.scopes,
      total: result.total,
      limit,
      offset,
    });
  });

  // GET /v1/data/:scope — read a data file (requires auth + grant)
  app.get(
    "/:scope",
    web3Auth,
    builderCheck,
    grantCheck,
    accessLog,
    async (c) => {
      // 1. Validate scope
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

      // 2. Determine lookup strategy: fileId, at, or latest
      const fileIdParam = c.req.query("fileId");
      const atParam = c.req.query("at");

      let entry;
      if (fileIdParam) {
        entry = deps.indexManager.findByFileId(fileIdParam);
      } else if (atParam) {
        entry = deps.indexManager.findClosestByScope(scope, atParam);
      } else {
        entry = deps.indexManager.findLatestByScope(scope);
      }

      // 3. 404 if not found
      if (!entry) {
        return c.json(
          {
            error: "NOT_FOUND",
            message: `No data found for scope "${scope}"`,
          },
          404,
        );
      }

      // 4. Read the data file from disk
      const envelope = await readDataFile(
        deps.hierarchyOptions,
        scope,
        entry.collectedAt,
      );

      // 5. Return 200 with envelope
      return c.json(envelope);
    },
  );

  app.use("/:scope", createBodyLimit(DATA_INGEST_MAX_SIZE));

  app.post("/:scope", async (c) => {
    // 1. Parse & validate scope
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

    // 2. Parse JSON body
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          error: "INVALID_BODY",
          message: "Request body must be valid JSON",
        },
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

    // 3. Look up schema via Gateway (strict: reject if not found)
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

    // 4. Generate collectedAt
    const collectedAt = generateCollectedAt();

    // 5. Construct envelope
    const envelope = createDataFileEnvelope(
      scope,
      collectedAt,
      body as Record<string, unknown>,
      schemaUrl,
    );

    // 6. Write atomically
    const writeResult = await writeDataFile(deps.hierarchyOptions, envelope);

    // 7. Insert into index
    deps.indexManager.insert({
      fileId: null,
      path: writeResult.relativePath,
      scope,
      collectedAt,
      sizeBytes: writeResult.sizeBytes,
    });

    deps.logger.info(
      { scope, collectedAt, path: writeResult.relativePath },
      "Data file ingested",
    );

    // 8. Notify sync manager of new data (if enabled)
    let status: "stored" | "syncing" = "stored";
    if (deps.syncManager) {
      deps.syncManager.notifyNewData();
      status = "syncing";
    }

    // 9. Return 201
    return c.json({ scope, collectedAt, status }, 201);
  });

  // Owner-check middleware (web3-auth + owner-check)
  const ownerCheck = createOwnerCheckMiddleware(deps.serverOwner);

  // DELETE /v1/data/:scope — delete all versions for a scope (owner auth required)
  app.delete("/:scope", web3Auth, ownerCheck, async (c) => {
    // 1. Validate scope
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

    // 2. Delete from index
    const deletedCount = deps.indexManager.deleteByScope(scope);

    // 3. Delete from filesystem
    await deleteAllForScope(deps.hierarchyOptions, scope);

    deps.logger.info({ scope, deletedCount }, "Scope deleted");

    // 4. Return 204
    return c.body(null, 204);
  });

  return app;
}
