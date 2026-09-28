import type { Readable } from "node:stream";

export type StorageKey = string; // org/{orgId}/{entity}/{id}/{client|internal}/{uuid}

export interface StoredObject {
  body: Readable | ReadableStream<Uint8Array>;
  contentType: string;
  bytes: number;
}

export interface StorageAdapter {
  put(key: StorageKey, data: Buffer | Uint8Array, contentType: string): Promise<{ bytes: number }>;
  get(key: StorageKey): Promise<StoredObject | null>;
  copy(from: StorageKey, to: StorageKey): Promise<void>;
  delete(key: StorageKey): Promise<void>;
  exists(key: StorageKey): Promise<boolean>;
  /** Presigned download URL (S3/R2) or an app route (local). */
  downloadUrl(key: StorageKey, opts?: { expiresInSec?: number; filename?: string }): Promise<string>;
}
