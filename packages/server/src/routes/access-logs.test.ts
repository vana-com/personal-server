import { describe, it, expect, vi } from 'vitest';
import { pino } from 'pino';
import type { AccessLogReader, AccessLogReadResult } from '@personal-server/core/logging/access-reader';
import { accessLogsRoutes } from './access-logs.js';

const logger = pino({ level: 'silent' });

function createMockReader(result: AccessLogReadResult): AccessLogReader {
  return {
    read: vi.fn().mockResolvedValue(result),
  };
}

describe('GET /', () => {
  it('returns { logs, total, limit: 50, offset: 0 } shape', async () => {
    const mockResult: AccessLogReadResult = {
      logs: [
        {
          logId: 'log-1',
          grantId: 'grant-1',
          builder: '0x1234567890abcdef1234567890abcdef12345678',
          action: 'read',
          scope: 'instagram.profile',
          timestamp: '2026-01-28T12:00:00Z',
          ipAddress: '127.0.0.1',
          userAgent: 'TestAgent/1.0',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };

    const reader = createMockReader(mockResult);
    const app = accessLogsRoutes({ logger, accessLogReader: reader });

    const res = await app.request('/', { method: 'GET' });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.logs).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.limit).toBe(50);
    expect(json.offset).toBe(0);
    expect(reader.read).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });

  it('passes limit and offset query params to reader', async () => {
    const mockResult: AccessLogReadResult = {
      logs: [],
      total: 20,
      limit: 10,
      offset: 5,
    };

    const reader = createMockReader(mockResult);
    const app = accessLogsRoutes({ logger, accessLogReader: reader });

    const res = await app.request('/?limit=10&offset=5', { method: 'GET' });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.limit).toBe(10);
    expect(json.offset).toBe(5);
    expect(reader.read).toHaveBeenCalledWith({ limit: 10, offset: 5 });
  });

  it('returns empty logs when no access logs exist', async () => {
    const mockResult: AccessLogReadResult = {
      logs: [],
      total: 0,
      limit: 50,
      offset: 0,
    };

    const reader = createMockReader(mockResult);
    const app = accessLogsRoutes({ logger, accessLogReader: reader });

    const res = await app.request('/', { method: 'GET' });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.logs).toEqual([]);
    expect(json.total).toBe(0);
  });

  it('defaults to limit=50 when non-numeric limit provided', async () => {
    const mockResult: AccessLogReadResult = {
      logs: [],
      total: 0,
      limit: 50,
      offset: 0,
    };

    const reader = createMockReader(mockResult);
    const app = accessLogsRoutes({ logger, accessLogReader: reader });

    const res = await app.request('/?limit=abc', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(reader.read).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });
});
