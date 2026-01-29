/**
 * Gateway client for communicating with the Vana Gateway API.
 * Provides builder registration checks and grant lookups.
 */

import type { GatewayGrantResponse } from '../grants/types.js';

export interface Builder {
  address: string;
  name: string;
  registered: boolean;
}

export interface GatewayClient {
  isRegisteredBuilder(address: string): Promise<boolean>;
  getBuilder(address: string): Promise<Builder | null>;
  getGrant(grantId: string): Promise<GatewayGrantResponse | null>;
}

export function createGatewayClient(baseUrl: string): GatewayClient {
  const base = baseUrl.replace(/\/+$/, '');

  return {
    async isRegisteredBuilder(address: string): Promise<boolean> {
      const builder = await this.getBuilder(address);
      return builder !== null && builder.registered;
    },

    async getBuilder(address: string): Promise<Builder | null> {
      const res = await fetch(`${base}/v1/builders/${address}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as Builder;
    },

    async getGrant(grantId: string): Promise<GatewayGrantResponse | null> {
      const res = await fetch(`${base}/v1/grants/${grantId}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as GatewayGrantResponse;
    },
  };
}
