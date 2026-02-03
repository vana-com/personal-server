import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { RequestSigner } from "./vana.js";
import { createVanaStorageAdapter } from "./vana.js";

const API_URL = "https://storage.vana.com";
const OWNER_ADDRESS = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";

describe("VanaStorageAdapter", () => {
  const originalFetch = globalThis.fetch;
  let mockSigner: RequestSigner;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    mockSigner = {
      signRequest: vi.fn().mockResolvedValue("Web3Signed mockPayload.0xsig"),
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchResponse(
    status: number,
    body?: unknown,
    headers?: Record<string, string>,
  ) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText:
        status === 200 ? "OK" : status === 404 ? "Not Found" : "Error",
      json: async () => body,
      arrayBuffer: async () => {
        if (body instanceof Uint8Array) {
          return body.buffer.slice(
            body.byteOffset,
            body.byteOffset + body.byteLength,
          );
        }
        return new ArrayBuffer(0);
      },
      headers: new Headers(headers),
    } as unknown as Response);
  }

  function fetchMock() {
    return globalThis.fetch as ReturnType<typeof vi.fn>;
  }

  function adapter() {
    return createVanaStorageAdapter({
      apiUrl: API_URL,
      ownerAddress: OWNER_ADDRESS,
      signer: mockSigner,
    });
  }

  describe("upload", () => {
    it("sends PUT with octet-stream body and Web3Signed auth, returns full HTTPS URL", async () => {
      mockFetchResponse(200, {
        key: `${OWNER_ADDRESS}/instagram.profile/2026-01-21T10-00-00Z`,
        url: `${API_URL}/v1/blobs/${OWNER_ADDRESS}/instagram.profile/2026-01-21T10-00-00Z`,
        etag: '"abc123"',
        size: 42,
      });

      const data = new Uint8Array([1, 2, 3, 4]);
      const url = await adapter().upload(
        "instagram.profile/2026-01-21T10-00-00Z",
        data,
      );

      expect(url).toBe(
        `${API_URL}/v1/blobs/${OWNER_ADDRESS}/instagram.profile/2026-01-21T10-00-00Z`,
      );

      const fetchCall = fetchMock().mock.calls[0];
      expect(fetchCall[0]).toBe(
        `${API_URL}/v1/blobs/${OWNER_ADDRESS}/instagram.profile/2026-01-21T10-00-00Z`,
      );
      const init = fetchCall[1] as RequestInit;
      expect(init.method).toBe("PUT");
      expect(Buffer.from(init.body as Buffer)).toEqual(Buffer.from(data));
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/octet-stream",
      );
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(
        "Web3Signed mockPayload.0xsig",
      );

      expect(mockSigner.signRequest).toHaveBeenCalledWith({
        aud: API_URL,
        method: "PUT",
        uri: `/v1/blobs/${OWNER_ADDRESS}/instagram.profile/2026-01-21T10-00-00Z`,
        body: data,
      });
    });

    it("throws on non-OK response", async () => {
      mockFetchResponse(500, { error: "INTERNAL_ERROR" });

      await expect(
        adapter().upload(
          "instagram.profile/2026-01-21T10-00-00Z",
          new Uint8Array([1]),
        ),
      ).rejects.toThrow("Vana Storage upload failed: 500");
    });
  });

  describe("download", () => {
    it("fetches blob with auth header, returns Uint8Array", async () => {
      const blobData = new Uint8Array([10, 20, 30]);
      mockFetchResponse(200, blobData);

      const storageUrl = `${API_URL}/v1/blobs/${OWNER_ADDRESS}/instagram.profile/2026-01-21T10-00-00Z`;
      const result = await adapter().download(storageUrl);

      expect(result).toEqual(blobData);
      expect(fetchMock()).toHaveBeenCalledWith(
        storageUrl,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Web3Signed mockPayload.0xsig",
          }),
        }),
      );

      expect(mockSigner.signRequest).toHaveBeenCalledWith({
        aud: API_URL,
        method: "GET",
        uri: `/v1/blobs/${OWNER_ADDRESS}/instagram.profile/2026-01-21T10-00-00Z`,
        body: undefined,
      });
    });

    it("throws on 404", async () => {
      const storageUrl = `${API_URL}/v1/blobs/${OWNER_ADDRESS}/missing/key`;
      mockFetchResponse(404);

      await expect(adapter().download(storageUrl)).rejects.toThrow(
        `Blob not found: ${storageUrl}`,
      );
    });
  });

  describe("delete", () => {
    it("returns true on success, false on 404, includes auth header", async () => {
      const storageUrl = `${API_URL}/v1/blobs/${OWNER_ADDRESS}/instagram.profile/2026-01-21T10-00-00Z`;

      // Success case
      mockFetchResponse(200, { deleted: true });
      const resultOk = await adapter().delete(storageUrl);
      expect(resultOk).toBe(true);

      expect(fetchMock()).toHaveBeenCalledWith(
        storageUrl,
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: "Web3Signed mockPayload.0xsig",
          }),
        }),
      );

      // 404 case
      mockFetchResponse(404);
      const resultNotFound = await adapter().delete(storageUrl);
      expect(resultNotFound).toBe(false);
    });
  });

  describe("exists", () => {
    it("returns true on 200, false on 404, includes auth header", async () => {
      const storageUrl = `${API_URL}/v1/blobs/${OWNER_ADDRESS}/instagram.profile/2026-01-21T10-00-00Z`;

      // 200 case
      mockFetchResponse(200);
      const existsOk = await adapter().exists(storageUrl);
      expect(existsOk).toBe(true);

      expect(fetchMock()).toHaveBeenCalledWith(
        storageUrl,
        expect.objectContaining({
          method: "HEAD",
          headers: expect.objectContaining({
            Authorization: "Web3Signed mockPayload.0xsig",
          }),
        }),
      );

      // 404 case
      mockFetchResponse(404);
      const existsNot = await adapter().exists(storageUrl);
      expect(existsNot).toBe(false);
    });
  });

  describe("URL format", () => {
    it('upload("instagram.profile/2026-01-21T10-00-00Z") returns correct URL', async () => {
      mockFetchResponse(200);

      const url = await adapter().upload(
        "instagram.profile/2026-01-21T10-00-00Z",
        new Uint8Array([1]),
      );

      expect(url).toBe(
        `https://storage.vana.com/v1/blobs/${OWNER_ADDRESS}/instagram.profile/2026-01-21T10-00-00Z`,
      );
    });
  });

  describe("download/delete/exists parse full HTTPS URLs correctly", () => {
    it("extracts pathname from full HTTPS URL for auth signing", async () => {
      const storageUrl = `${API_URL}/v1/blobs/${OWNER_ADDRESS}/chatgpt.conversations/2026-01-22T10-00-00Z`;

      // download
      const blobData = new Uint8Array([42]);
      mockFetchResponse(200, blobData);
      await adapter().download(storageUrl);
      expect(mockSigner.signRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          uri: `/v1/blobs/${OWNER_ADDRESS}/chatgpt.conversations/2026-01-22T10-00-00Z`,
        }),
      );

      // delete
      mockFetchResponse(200, { deleted: true });
      await adapter().delete(storageUrl);
      expect(mockSigner.signRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "DELETE",
          uri: `/v1/blobs/${OWNER_ADDRESS}/chatgpt.conversations/2026-01-22T10-00-00Z`,
        }),
      );

      // exists
      mockFetchResponse(200);
      await adapter().exists(storageUrl);
      expect(mockSigner.signRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "HEAD",
          uri: `/v1/blobs/${OWNER_ADDRESS}/chatgpt.conversations/2026-01-22T10-00-00Z`,
        }),
      );
    });
  });

  describe("deleteScope", () => {
    it("calls DELETE on scope path, returns count", async () => {
      mockFetchResponse(200, {
        deleted: true,
        scope: "instagram.profile",
        count: 42,
      });

      const a = adapter();
      const count = await a.deleteScope!("instagram.profile");

      expect(count).toBe(42);
      expect(fetchMock()).toHaveBeenCalledWith(
        `${API_URL}/v1/blobs/${OWNER_ADDRESS}/instagram.profile`,
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: "Web3Signed mockPayload.0xsig",
          }),
        }),
      );

      expect(mockSigner.signRequest).toHaveBeenCalledWith({
        aud: API_URL,
        method: "DELETE",
        uri: `/v1/blobs/${OWNER_ADDRESS}/instagram.profile`,
        body: undefined,
      });
    });

    it("throws on non-OK response", async () => {
      mockFetchResponse(500);

      await expect(adapter().deleteScope!("instagram.profile")).rejects.toThrow(
        "Vana Storage deleteScope failed: 500",
      );
    });
  });

  describe("deleteAll", () => {
    it("calls DELETE on owner path, returns count", async () => {
      mockFetchResponse(200, {
        deleted: true,
        ownerAddress: OWNER_ADDRESS,
        count: 1337,
      });

      const a = adapter();
      const count = await a.deleteAll!();

      expect(count).toBe(1337);
      expect(fetchMock()).toHaveBeenCalledWith(
        `${API_URL}/v1/blobs/${OWNER_ADDRESS}`,
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: "Web3Signed mockPayload.0xsig",
          }),
        }),
      );

      expect(mockSigner.signRequest).toHaveBeenCalledWith({
        aud: API_URL,
        method: "DELETE",
        uri: `/v1/blobs/${OWNER_ADDRESS}`,
        body: undefined,
      });
    });

    it("throws on non-OK response", async () => {
      mockFetchResponse(500);

      await expect(adapter().deleteAll!()).rejects.toThrow(
        "Vana Storage deleteAll failed: 500",
      );
    });
  });
});
