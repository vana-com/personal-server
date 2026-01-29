import { describe, it, expect } from 'vitest';
import { pino } from 'pino';
import { syncRoutes } from './sync.js';

const logger = pino({ level: 'silent' });

describe('syncRoutes', () => {
  const app = syncRoutes({ logger });

  describe('POST /trigger', () => {
    it('returns 202 with status started', async () => {
      const res = await app.request('/trigger', { method: 'POST' });

      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json).toEqual({ status: 'started', message: 'Sync triggered' });
    });
  });

  describe('GET /status', () => {
    it('returns 200 with stub sync status', async () => {
      const res = await app.request('/status', { method: 'GET' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        lastSync: null,
        lastProcessedTimestamp: null,
        pendingFiles: 0,
        errors: [],
      });
    });
  });

  describe('POST /file/:fileId', () => {
    it('returns 202 with fileId and status started', async () => {
      const res = await app.request('/file/0x123', { method: 'POST' });

      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json).toEqual({ fileId: '0x123', status: 'started' });
    });
  });
});
