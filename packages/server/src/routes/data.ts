import { Hono } from 'hono'
import { ScopeSchema } from '@personal-server/core/scopes'
import { createDataFileEnvelope } from '@personal-server/core/schemas/data-file'
import {
  generateCollectedAt,
  writeDataFile,
} from '@personal-server/core/storage/hierarchy'
import type { HierarchyManagerOptions } from '@personal-server/core/storage/hierarchy'
import type { IndexManager } from '@personal-server/core/storage/index'
import type { Logger } from 'pino'
import { createBodyLimit, DATA_INGEST_MAX_SIZE } from '../middleware/body-limit.js'

export interface DataRouteDeps {
  indexManager: IndexManager
  hierarchyOptions: HierarchyManagerOptions
  logger: Logger
}

export function dataRoutes(deps: DataRouteDeps): Hono {
  const app = new Hono()

  app.use('/:scope', createBodyLimit(DATA_INGEST_MAX_SIZE))

  app.post('/:scope', async (c) => {
    // 1. Parse & validate scope
    const scopeParam = c.req.param('scope')
    const scopeResult = ScopeSchema.safeParse(scopeParam)
    if (!scopeResult.success) {
      return c.json(
        {
          error: 'INVALID_SCOPE',
          message: scopeResult.error.issues[0].message,
        },
        400,
      )
    }
    const scope = scopeResult.data

    // 2. Parse JSON body
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(
        {
          error: 'INVALID_BODY',
          message: 'Request body must be valid JSON',
        },
        400,
      )
    }

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return c.json(
        {
          error: 'INVALID_BODY',
          message: 'Request body must be a JSON object',
        },
        400,
      )
    }

    // 3. Generate collectedAt
    const collectedAt = generateCollectedAt()

    // 4. Construct envelope
    const envelope = createDataFileEnvelope(scope, collectedAt, body as Record<string, unknown>)

    // 5. Write atomically
    const writeResult = await writeDataFile(deps.hierarchyOptions, envelope)

    // 6. Insert into index
    deps.indexManager.insert({
      fileId: null,
      path: writeResult.relativePath,
      scope,
      collectedAt,
      sizeBytes: writeResult.sizeBytes,
    })

    deps.logger.info({ scope, collectedAt, path: writeResult.relativePath }, 'Data file ingested')

    // 7. Return 201
    return c.json({ scope, collectedAt, status: 'stored' as const }, 201)
  })

  return app
}
