import { bodyLimit } from 'hono/body-limit'
import type { MiddlewareHandler } from 'hono'

/** 50 MB — max body size for data ingest routes */
export const DATA_INGEST_MAX_SIZE = 50 * 1024 * 1024

/** 1 MB — default max body size for general routes */
export const DEFAULT_MAX_SIZE = 1 * 1024 * 1024

/**
 * Creates a Hono body-limit middleware that returns 413 JSON on overflow.
 */
export function createBodyLimit(maxSize: number): MiddlewareHandler {
  return bodyLimit({
    maxSize,
    onError: (c) => {
      return c.json(
        {
          error: 'CONTENT_TOO_LARGE',
          message: `Request body exceeds maximum size of ${maxSize} bytes`,
        },
        413,
      )
    },
  })
}
