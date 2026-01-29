/**
 * Sync stub routes — placeholder endpoints for Phase 4 sync engine.
 * Owner auth is wired in Task 4.1.
 */

import { Hono } from 'hono';
import type { Logger } from 'pino';
import { createWeb3AuthMiddleware } from '../middleware/web3-auth.js';
import { createOwnerCheckMiddleware } from '../middleware/owner-check.js';

export interface SyncRouteDeps {
  logger: Logger;
  serverOrigin: string;
  serverOwner: `0x${string}`;
}

export function syncRoutes(deps: SyncRouteDeps): Hono {
  const app = new Hono();

  const web3Auth = createWeb3AuthMiddleware(deps.serverOrigin);
  const ownerCheck = createOwnerCheckMiddleware(deps.serverOwner);

  // POST /trigger — request a full sync (owner auth required)
  app.post('/trigger', web3Auth, ownerCheck, async (c) => {
    deps.logger.info('Sync trigger requested (stub)');
    return c.json({ status: 'started', message: 'Sync triggered' }, 202);
  });

  // GET /status — current sync status (owner auth required)
  app.get('/status', web3Auth, ownerCheck, async (c) => {
    return c.json({
      lastSync: null,
      lastProcessedTimestamp: null,
      pendingFiles: 0,
      errors: [],
    });
  });

  // POST /file/:fileId — request sync for a specific file (owner auth required)
  app.post('/file/:fileId', web3Auth, ownerCheck, async (c) => {
    const fileId = c.req.param('fileId');
    deps.logger.info({ fileId }, 'File sync requested (stub)');
    return c.json({ fileId, status: 'started' }, 202);
  });

  return app;
}
