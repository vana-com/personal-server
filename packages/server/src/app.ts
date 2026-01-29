import { Hono } from 'hono'
import { ProtocolError } from '@personal-server/core/errors'
import { healthRoute } from './routes/health.js'
import type { Logger } from 'pino'

export interface AppDeps {
  logger: Logger
  version: string
  startedAt: Date
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  // Mount health route
  app.route('/', healthRoute({ version: deps.version, startedAt: deps.startedAt }))

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof ProtocolError) {
      deps.logger.warn({ err }, err.message)
      return c.json(err.toJSON(), err.code as 401 | 403 | 413)
    }

    deps.logger.error({ err }, 'Unhandled error')
    return c.json(
      {
        error: {
          code: 500,
          errorCode: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      },
      500,
    )
  })

  // 404 fallback
  app.notFound((c) => {
    return c.json(
      {
        error: {
          code: 404,
          errorCode: 'NOT_FOUND',
          message: 'Not found',
        },
      },
      404,
    )
  })

  return app
}
