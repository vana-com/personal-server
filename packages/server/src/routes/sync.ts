/**
 * Sync stub routes — placeholder endpoints for Phase 4 sync engine.
 * Owner auth is wired in Task 4.1.
 */

import { Hono } from 'hono';
import type { Logger } from 'pino';

export interface SyncRouteDeps {
  logger: Logger;
}

export function syncRoutes(deps: SyncRouteDeps): Hono {
  const app = new Hono();

  // POST /trigger — request a full sync
  app.post('/trigger', async (c) => {
    deps.logger.info('Sync trigger requested (stub)');
    return c.json({ status: 'started', message: 'Sync triggered' }, 202);
  });

  // GET /status — current sync status
  app.get('/status', async (c) => {
    return c.json({
      lastSync: null,
      lastProcessedTimestamp: null,
      pendingFiles: 0,
      errors: [],
    });
  });

  // POST /file/:fileId — request sync for a specific file
  app.post('/file/:fileId', async (c) => {
    const fileId = c.req.param('fileId');
    deps.logger.info({ fileId }, 'File sync requested (stub)');
    return c.json({ fileId, status: 'started' }, 202);
  });

  return app;
}
