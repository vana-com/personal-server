/**
 * Abstract storage backend adapter.
 * All methods operate on encrypted binary blobs.
 * Keys are opaque strings (e.g., "{scope}/{collectedAt}").
 */
export interface StorageAdapter {
  /**
   * Upload an encrypted blob to the storage backend.
   * @param key - unique storage key / path
   * @param data - encrypted binary data
   * @returns URL where the blob is accessible
   */
  upload(key: string, data: Uint8Array): Promise<string>;

  /**
   * Download an encrypted blob from the storage backend.
   * @param url - storage URL returned by upload()
   * @returns encrypted binary data
   * @throws if blob not found
   */
  download(url: string): Promise<Uint8Array>;

  /**
   * Delete an encrypted blob from the storage backend.
   * @param url - storage URL
   * @returns true if deleted, false if not found
   */
  delete(url: string): Promise<boolean>;

  /**
   * Check if a blob exists in the storage backend.
   * @param url - storage URL
   * @returns true if blob exists
   */
  exists(url: string): Promise<boolean>;

  /**
   * Bulk delete all blobs for a scope.
   * Optional — not all backends support bulk delete.
   * @param scope - scope identifier (dot notation)
   * @returns count of blobs deleted
   */
  deleteScope?(scope: string): Promise<number>;

  /**
   * Delete all blobs for the owner.
   * Optional — not all backends support bulk delete.
   * @returns count of blobs deleted
   */
  deleteAll?(): Promise<number>;
}
