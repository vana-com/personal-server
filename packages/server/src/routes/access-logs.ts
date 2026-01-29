/**
 * Access logs routes — GET / returns paginated access log entries.
 * Owner auth is wired in Task 4.1.
 */

import { Hono } from 'hono';
import type { Logger } from 'pino';
import type { AccessLogReader } from '@personal-server/core/logging/access-reader';

export interface AccessLogsRouteDeps {
  logger: Logger;
  accessLogReader: AccessLogReader;
}

export function accessLogsRoutes(deps: AccessLogsRouteDeps): Hono {
  const app = new Hono();

  // GET / — list access logs with pagination
  app.get('/', async (c) => {
    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');

    const limit = limitParam !== undefined ? parseInt(limitParam, 10) : 50;
    const offset = offsetParam !== undefined ? parseInt(offsetParam, 10) : 0;

    const result = await deps.accessLogReader.read({
      limit: Number.isNaN(limit) ? 50 : limit,
      offset: Number.isNaN(offset) ? 0 : offset,
    });

    return c.json(result);
  });

  return app;
}
