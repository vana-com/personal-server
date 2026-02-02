/**
 * Gateway client for communicating with the Vana Gateway API.
 * Provides builder registration checks and grant lookups.
 *
 * All Gateway GET endpoints return responses wrapped in:
 *   { data: T, proof: GatewayProof }
 * This client unwraps the envelope and returns just the data.
 */

import type { GatewayGrantResponse } from "../grants/types.js";

/** Gateway response envelope wrapping all GET responses */
export interface GatewayEnvelope<T> {
  data: T;
  proof: GatewayProof;
}

export interface GatewayProof {
  signature: string;
  timestamp: string;
  gatewayAddress: string;
  requestHash: string;
  responseHash: string;
  userSignature: string;
  status: string;
  chainBlockHeight: number;
}

export interface Builder {
  id: string;
  ownerAddress: string;
  granteeAddress: string;
  publicKey: string;
  appUrl: string;
  addedAt: string;
}

export interface Schema {
  id: string;
  ownerAddress: string;
  name: string;
  definitionUrl: string;
  scope: string;
  addedAt: string;
}

export interface ServerInfo {
  id: string;
  ownerAddress: string;
  serverAddress: string;
  publicKey: string;
  serverUrl: string;
  addedAt: string;
}

export interface GrantListItem {
  id: string;
  grantorAddress: string;
  granteeId: string;
  grant: string;
  fileIds: string[];
  status: "pending" | "confirmed";
  addedAt: string;
  revokedAt: string | null;
  revocationSignature: string | null;
}

export interface RegisterFileParams {
  ownerAddress: string;
  url: string;
  schemaId: string;
  signature: string;
}

export interface CreateGrantParams {
  grantorAddress: string;
  granteeId: string;
  grant: string;
  fileIds: string[];
  signature: string;
}

export interface RevokeGrantParams {
  grantId: string;
  grantorAddress: string;
  signature: string;
}

export interface GatewayClient {
  isRegisteredBuilder(address: string): Promise<boolean>;
  getBuilder(address: string): Promise<Builder | null>;
  getGrant(grantId: string): Promise<GatewayGrantResponse | null>;
  listGrantsByUser(userAddress: string): Promise<GrantListItem[]>;
  getSchemaForScope(scope: string): Promise<Schema | null>;
  getServer(address: string): Promise<ServerInfo | null>;
  registerFile(params: RegisterFileParams): Promise<{ fileId?: string }>;
  createGrant(params: CreateGrantParams): Promise<{ grantId?: string }>;
  revokeGrant(params: RevokeGrantParams): Promise<void>;
}

export function createGatewayClient(baseUrl: string): GatewayClient {
  const base = baseUrl.replace(/\/+$/, "");

  async function unwrapEnvelope<T>(res: Response): Promise<T> {
    const envelope = (await res.json()) as GatewayEnvelope<T>;
    return envelope.data;
  }

  return {
    async isRegisteredBuilder(address: string): Promise<boolean> {
      const builder = await this.getBuilder(address);
      // Gateway returns 200 with builder data if registered, 404 if not.
      // Existence IS registration — no separate `registered` field.
      return builder !== null;
    },

    async getBuilder(address: string): Promise<Builder | null> {
      const res = await fetch(`${base}/v1/builders/${address}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      return unwrapEnvelope<Builder>(res);
    },

    async getGrant(grantId: string): Promise<GatewayGrantResponse | null> {
      const res = await fetch(`${base}/v1/grants/${grantId}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      return unwrapEnvelope<GatewayGrantResponse>(res);
    },

    async listGrantsByUser(userAddress: string): Promise<GrantListItem[]> {
      const res = await fetch(`${base}/v1/grants?user=${userAddress}`);
      if (res.status === 404) return [];
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      return unwrapEnvelope<GrantListItem[]>(res);
    },

    async getSchemaForScope(scope: string): Promise<Schema | null> {
      const res = await fetch(`${base}/v1/schemas?scope=${scope}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      return unwrapEnvelope<Schema>(res);
    },

    async getServer(address: string): Promise<ServerInfo | null> {
      const res = await fetch(`${base}/v1/servers/${address}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      return unwrapEnvelope<ServerInfo>(res);
    },

    async registerFile(
      params: RegisterFileParams,
    ): Promise<{ fileId?: string }> {
      const res = await fetch(`${base}/v1/files`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Web3Signed ${params.signature}`,
        },
        body: JSON.stringify({
          ownerAddress: params.ownerAddress,
          url: params.url,
          schemaId: params.schemaId,
        }),
      });
      // 409 = already registered, treat as success (idempotent)
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        return {
          fileId: (body as Record<string, unknown>).fileId as
            | string
            | undefined,
        };
      }
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      const body = await res.json();
      return {
        fileId: (body as Record<string, unknown>).fileId as string | undefined,
      };
    },

    async createGrant(
      params: CreateGrantParams,
    ): Promise<{ grantId?: string }> {
      const res = await fetch(`${base}/v1/grants`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Web3Signed ${params.signature}`,
        },
        body: JSON.stringify({
          grantorAddress: params.grantorAddress,
          granteeId: params.granteeId,
          grant: params.grant,
          fileIds: params.fileIds,
        }),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        return {
          grantId: (body as Record<string, unknown>).grantId as
            | string
            | undefined,
        };
      }
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
      const body = await res.json();
      return {
        grantId: (body as Record<string, unknown>).grantId as
          | string
          | undefined,
      };
    },

    async revokeGrant(params: RevokeGrantParams): Promise<void> {
      const res = await fetch(`${base}/v1/grants/${params.grantId}/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Web3Signed ${params.signature}`,
        },
        body: JSON.stringify({
          grantorAddress: params.grantorAddress,
        }),
      });
      if (res.status === 409) return; // already revoked
      if (!res.ok) {
        throw new Error(`Gateway error: ${res.status} ${res.statusText}`);
      }
    },
  };
}
