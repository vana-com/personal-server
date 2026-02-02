/**
 * Vana Storage adapter.
 * Uses REST: PUT/GET/DELETE/HEAD against {apiUrl}/v1/blobs/{ownerAddress}/{key}
 * Auth: Web3Signed header on all requests (see vana-storage-design.md Section 3).
 * URL format: full HTTPS URL (no vana:// scheme).
 */

import type { StorageAdapter } from "./interface.js";

/**
 * Signs HTTP requests for Web3Signed auth.
 * Produces "Web3Signed {base64url(payload)}.{signature}" header values.
 * Implementation provided by the caller (typically wraps the server keypair).
 */
export interface RequestSigner {
  /**
   * Produce a Web3Signed Authorization header value for an HTTP request.
   * @param params - request metadata to sign
   * @returns full Authorization header value (e.g., "Web3Signed ...")
   */
  signRequest(params: {
    aud: string;
    method: string;
    uri: string;
    body?: Uint8Array;
  }): Promise<string>;
}

export interface VanaStorageOptions {
  apiUrl: string;
  ownerAddress: string;
  signer: RequestSigner;
}

export function createVanaStorageAdapter(
  options: VanaStorageOptions,
): StorageAdapter {
  const base = options.apiUrl.replace(/\/+$/, "");
  const { ownerAddress, signer } = options;

  function blobUrl(key: string): string {
    return `${base}/v1/blobs/${ownerAddress}/${key}`;
  }

  async function authHeaders(
    method: string,
    uri: string,
    body?: Uint8Array,
  ): Promise<Record<string, string>> {
    const header = await signer.signRequest({
      aud: options.apiUrl,
      method,
      uri,
      body,
    });
    return { Authorization: header };
  }

  return {
    async upload(key, data) {
      const url = blobUrl(key);
      const uri = `/v1/blobs/${ownerAddress}/${key}`;
      const auth = await authHeaders("PUT", uri, data);
      const res = await fetch(url, {
        method: "PUT",
        body: Buffer.from(data),
        headers: {
          "Content-Type": "application/octet-stream",
          ...auth,
        },
      });
      if (!res.ok) {
        throw new Error(
          `Vana Storage upload failed: ${res.status} ${res.statusText}`,
        );
      }
      return url;
    },

    async download(storageUrl) {
      const uri = new URL(storageUrl).pathname;
      const auth = await authHeaders("GET", uri);
      const res = await fetch(storageUrl, { headers: auth });
      if (res.status === 404) {
        throw new Error(`Blob not found: ${storageUrl}`);
      }
      if (!res.ok) {
        throw new Error(
          `Vana Storage download failed: ${res.status} ${res.statusText}`,
        );
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    async delete(storageUrl) {
      const uri = new URL(storageUrl).pathname;
      const auth = await authHeaders("DELETE", uri);
      const res = await fetch(storageUrl, {
        method: "DELETE",
        headers: auth,
      });
      if (res.status === 404) return false;
      if (!res.ok) {
        throw new Error(
          `Vana Storage delete failed: ${res.status} ${res.statusText}`,
        );
      }
      return true;
    },

    async exists(storageUrl) {
      const uri = new URL(storageUrl).pathname;
      const auth = await authHeaders("HEAD", uri);
      const res = await fetch(storageUrl, { method: "HEAD", headers: auth });
      return res.ok;
    },

    async deleteScope(scope) {
      const url = `${base}/v1/blobs/${ownerAddress}/${scope}`;
      const uri = `/v1/blobs/${ownerAddress}/${scope}`;
      const auth = await authHeaders("DELETE", uri);
      const res = await fetch(url, { method: "DELETE", headers: auth });
      if (!res.ok) {
        throw new Error(
          `Vana Storage deleteScope failed: ${res.status} ${res.statusText}`,
        );
      }
      const body = (await res.json()) as { count?: number };
      return body.count ?? 0;
    },

    async deleteAll() {
      const url = `${base}/v1/blobs/${ownerAddress}`;
      const uri = `/v1/blobs/${ownerAddress}`;
      const auth = await authHeaders("DELETE", uri);
      const res = await fetch(url, { method: "DELETE", headers: auth });
      if (!res.ok) {
        throw new Error(
          `Vana Storage deleteAll failed: ${res.status} ${res.statusText}`,
        );
      }
      const body = (await res.json()) as { count?: number };
      return body.count ?? 0;
    },
  };
}
