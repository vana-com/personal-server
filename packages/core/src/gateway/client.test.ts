import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { GatewayGrantResponse } from '../grants/types.js';

import { createGatewayClient } from './client.js';

const BASE_URL = 'https://gateway.example.com';

describe('GatewayClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, body?: unknown) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : status === 404 ? 'Not Found' : 'Error',
      json: async () => body,
    });
  }

  function mockFetchError(error: Error) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);
  }

  describe('isRegisteredBuilder', () => {
    it('returns true on 200 with registered builder', async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(200, { address: '0xabc', name: 'TestBuilder', registered: true });
      const result = await client.isRegisteredBuilder('0xabc');
      expect(result).toBe(true);
    });

    it('returns false on 404', async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(404);
      const result = await client.isRegisteredBuilder('0xabc');
      expect(result).toBe(false);
    });

    it('throws on network error', async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetchError(new Error('Network failure'));
      await expect(client.isRegisteredBuilder('0xabc')).rejects.toThrow('Network failure');
    });
  });

  describe('getGrant', () => {
    it('returns parsed response on 200', async () => {
      const client = createGatewayClient(BASE_URL);
      const grantResponse: GatewayGrantResponse = {
        grantId: 'grant-1',
        user: '0xuser',
        builder: '0xbuilder',
        scopes: ['instagram.*'],
        expiresAt: 9999999999,
        revoked: false,
      };
      mockFetch(200, grantResponse);
      const result = await client.getGrant('grant-1');
      expect(result).toEqual(grantResponse);
      expect(globalThis.fetch).toHaveBeenCalledWith(`${BASE_URL}/v1/grants/grant-1`);
    });

    it('returns null on 404', async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetch(404);
      const result = await client.getGrant('nonexistent');
      expect(result).toBeNull();
    });

    it('throws on network error', async () => {
      const client = createGatewayClient(BASE_URL);
      mockFetchError(new Error('Network failure'));
      await expect(client.getGrant('grant-1')).rejects.toThrow('Network failure');
    });
  });
});
