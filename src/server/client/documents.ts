/**
 * Client documents (SPEC F-23 client side): only `visibility=client` rows of client kinds, in the caller's org, served
 * through /api/files (which itself refuses any `/internal/` key for clients — defence in depth, SPEC 5.6).
 * App schema only; no supplier import path.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { documents, files } from "@/db/schema/app";
import { INTERNAL_ONLY_DOCUMENT_KINDS, type EntityType } from "@/db/enums";
import { getStorage } from "@/server/shared/storage";
import { ClientDocumentDto } from "./dto/document";
import { ClientDocumentListDto } from "./dto/documents";

export type ClientDocTarget = { entityType: EntityType; entityId: string };

/** Builds the client download URL for a stored file. The key's visibility segment must be `client` (asserted). */
export function clientDownloadUrl(storageKey: string, filename: string): string {
  if (storageKey.split("/")[4] !== "client") throw new Error("refusing to expose a non-client storage key");
  return `/api/files/${storageKey}?filename=${encodeURIComponent(filename)}&dl=1`;
}

/** Union of client-visible documents on the given entities (order + its lines + their samples), newest first. */
export async function clientDocumentsFor(db: DbOrTx, orgId: string, targets: ClientDocTarget[]): Promise<ClientDocumentDto[]> {
  if (!targets.length) return [];
  const rows = await db
    .select({ d: documents, f: files })
    .from(documents)
    .innerJoin(files, eq(files.id, documents.fileId))
    .where(and(eq(documents.orgId, orgId), inArray(documents.entityId, targets.map((t) => t.entityId)), eq(documents.visibility, "client"), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt));
  const allowed = new Set(targets.map((t) => `${t.entityType}:${t.entityId}`));
  const out: ClientDocumentDto[] = [];
  for (const { d, f } of rows) {
    if (!allowed.has(`${d.entityType}:${d.entityId}`)) continue;
    if (INTERNAL_ONLY_DOCUMENT_KINDS.includes(d.kind)) continue;
    if (f.storageKey.split("/")[4] !== "client") continue; // never serialise a row whose object still sits under /internal/
    out.push(ClientDocumentDto.parse({ id: d.id, filename: d.filename, kind: d.kind, bytes: f.bytes, uploadedAt: d.createdAt.toISOString(), downloadUrl: clientDownloadUrl(f.storageKey, d.filename) }));
  }
  return out;
}

/** One client-visible document by id (for artwork / dieline / report / B-L links). Null when internal or another org's. */
export async function clientDocumentById(db: DbOrTx, orgId: string, id: string | null | undefined): Promise<ClientDocumentDto | null> {
  if (!id) return null;
  const [row] = await db.select({ d: documents, f: files }).from(documents).innerJoin(files, eq(files.id, documents.fileId)).where(and(eq(documents.id, id), eq(documents.orgId, orgId), eq(documents.visibility, "client"), isNull(documents.deletedAt))).limit(1);
  if (!row || INTERNAL_ONLY_DOCUMENT_KINDS.includes(row.d.kind) || row.f.storageKey.split("/")[4] !== "client") return null;
  return ClientDocumentDto.parse({ id: row.d.id, filename: row.d.filename, kind: row.d.kind, bytes: row.f.bytes, uploadedAt: row.d.createdAt.toISOString(), downloadUrl: clientDownloadUrl(row.f.storageKey, row.d.filename) });
}

/** Same, addressed by file id (artworks.file_id / dieline_file_id point at files, not documents). */
export async function clientDocumentByFileId(db: DbOrTx, orgId: string, fileId: string | null | undefined): Promise<ClientDocumentDto | null> {
  if (!fileId) return null;
  const [row] = await db.select({ d: documents, f: files }).from(documents).innerJoin(files, eq(files.id, documents.fileId)).where(and(eq(documents.fileId, fileId), eq(documents.orgId, orgId), eq(documents.visibility, "client"), isNull(documents.deletedAt))).limit(1);
  if (!row || INTERNAL_ONLY_DOCUMENT_KINDS.includes(row.d.kind) || row.f.storageKey.split("/")[4] !== "client") return null;
  return ClientDocumentDto.parse({ id: row.d.id, filename: row.d.filename, kind: row.d.kind, bytes: row.f.bytes, uploadedAt: row.d.createdAt.toISOString(), downloadUrl: clientDownloadUrl(row.f.storageKey, row.d.filename) });
}

export function toDocumentList(items: ClientDocumentDto[]): ClientDocumentListDto {
  const counts: Record<string, number> = {};
  for (const d of items) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
  return ClientDocumentListDto.parse({ items, counts });
}

/** Ensures the storage adapter is the one that produces /api/files links (local) — exported for tests/preview. */
export const storageDownloadUrl = (key: string, filename: string) => getStorage().downloadUrl(key, { filename });
