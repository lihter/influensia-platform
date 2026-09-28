import type { StorageAdapter } from "./types";
import { LocalDiskStorage } from "./local";
import { S3Storage } from "./s3";

export type { StorageAdapter, StorageKey } from "./types";
export { assertValidKey } from "./local";

type G = { __influensiaStorage?: StorageAdapter };
const g = globalThis as unknown as G;

/** Local disk by default (./.data/files); R2/S3 when S3_BUCKET is set. */
export function getStorage(): StorageAdapter {
  if (g.__influensiaStorage) return g.__influensiaStorage;
  g.__influensiaStorage = process.env.S3_BUCKET
    ? new S3Storage({ bucket: process.env.S3_BUCKET, endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? "auto" })
    : new LocalDiskStorage();
  return g.__influensiaStorage;
}

/** Key prefix rule (mechanism 5): org/{orgId}/{entity}/{entityId}/{client|internal}/{uuid}[.ext] */
export function fileKey(p: { orgId: string; entity: string; entityId: string; visibility: "client" | "internal"; id: string; ext?: string }) {
  return `org/${p.orgId}/${p.entity}/${p.entityId}/${p.visibility}/${p.id}${p.ext ? `.${p.ext}` : ""}`;
}

/** Flip a key's visibility segment (used by publishDocument to derive the client copy's key). */
export function withVisibility(key: string, visibility: "client" | "internal") {
  const parts = key.split("/");
  parts[4] = visibility;
  return parts.join("/");
}
