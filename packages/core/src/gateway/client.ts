/**
 * Gateway client for communicating with the Vana Gateway API.
 * Provides builder registration checks and grant lookups.
 */

import type { GatewayGrantResponse } from "../grants/types.js";

export interface Builder {
  address: string;
  name: string;
  registered: boolean;
}

export interface Schema {
  schemaId: string;
  scope: string;
  url: string;
}

export interface ServerInfo {
  address: string;
  endpoint: string;
  registered: boolean;
  trusted: boolean;
}

export interface GrantListItem {
  grantId: string;
  builder: string;
  scopes: string[];
  expiresAt: number;
  createdAt: string;
}

export interface GatewayClient {
  isRegisteredBuilder(address: string): Promise<boolean>;
  getBuilder(address: string): Promise<Builder | null>;
  getGrant(grantId: string): Promise<GatewayGrantResponse | null>;
  listGrantsByUser(userAddress: string): Promise<GrantListItem[]>;
  getSchemaForScope(scope: string): Promise<Schema | null>;
  getServer(address: string): Promise<ServerInfo | null>;
}

export function createGatewayClient(baseUrl: string): GatewayClient {
  const base = baseUrl.replace(/\/+$/, "");

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

    async listGrantsByUser(userAddress: string): Promise<GrantListItem[]> {
      const res = await fetch(`${base}/v1/grants?user=${userAddress}`);
      if (res.status === 404) return [];
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as GrantListItem[];
    },

    async getSchemaForScope(scope: string): Promise<Schema | null> {
      const res = await fetch(`${base}/v1/schemas?scope=${scope}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as Schema;
    },

    async getServer(address: string): Promise<ServerInfo | null> {
      const res = await fetch(`${base}/v1/servers/${address}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as ServerInfo;
    },
  };
}
