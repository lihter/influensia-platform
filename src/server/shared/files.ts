import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb, type DbOrTx } from "@/db";
import { files, documents } from "@/db/schema/app";
import type { DocumentKind, EntityType, Visibility } from "@/db/enums";
import { INTERNAL_ONLY_DOCUMENT_KINDS } from "@/db/enums";
import { getStorage, fileKey, assertValidKey } from "./storage";
import { logActivity } from "./activity";
import { now } from "./clock";
import { leakCheck, type LeakSources, LeakCheckError } from "./leak-check";

const IMAGE = /^image\/(jpeg|png|webp)$/;

export type StoredFile = { id: string; key: string; bytes: number; mime: string; exifStripped: boolean };

/**
 * Stores an upload under the org/entity/visibility prefix (mechanism 5). Images are re-encoded with sharp
 * (`.rotate().jpeg()` — never `.withMetadata()`), which is what strips EXIF (mechanism 7).
 */
export async function storeUpload(
  db: DbOrTx,
  p: { orgId: string; userId: string | null; data: Buffer; mime: string; originalName: string; entity: EntityType; entityId: string; visibility: Visibility; at?: Date },
): Promise<StoredFile> {
  let { data, mime } = p;
  let ext = p.originalName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  let exifStripped = false;
  if (IMAGE.test(mime)) {
    const sharp = (await import("sharp")).default;
    data = await sharp(data).rotate().jpeg({ quality: 88 }).toBuffer();
    mime = "image/jpeg"; ext = "jpg"; exifStripped = true;
  }
  const id = uuidv7();
  const key = fileKey({ orgId: p.orgId, entity: p.entity, entityId: p.entityId, visibility: p.visibility, id, ext });
  const { bytes } = await getStorage().put(key, data, mime);
  await db.insert(files).values({ id, orgId: p.orgId, storageKey: key, mime, bytes, sha256: createHash("sha256").update(data).digest("hex"), originalName: p.originalName, exifStripped, createdBy: p.userId, createdAt: p.at ?? now() });
  return { id, key, bytes, mime, exifStripped };
}

/** Upload + documents row + `document_uploaded` event in one go. Filename is leak-checked for client uploads. */
export async function storeDocument(
  db: DbOrTx,
  p: { orgId: string; userId: string | null; actorName?: string; data: Buffer; mime: string; filename: string; entity: EntityType; entityId: string; kind: DocumentKind; visibility: Visibility; at?: Date; sources?: LeakSources },
) {
  if (p.visibility === "client" && p.sources) {
    const r = leakCheck({ filenames: [p.filename] }, p.sources);
    if (!r.ok) throw new LeakCheckError(r.hits);
  }
  const file = await storeUpload(db, { ...p, originalName: p.filename });
  const id = uuidv7();
  const at = p.at ?? now();
  await db.insert(documents).values({ id, orgId: p.orgId, entityType: p.entity, entityId: p.entityId, fileId: file.id, filename: p.filename, kind: p.kind, visibility: p.visibility, uploadedBy: p.userId, publishedAt: p.visibility === "client" ? at : null, publishedBy: p.visibility === "client" ? p.userId : null, createdBy: p.userId, createdAt: at, updatedAt: at });
  await logActivity(db, { orgId: p.orgId, entityType: p.entity, entityId: p.entityId, type: "document_uploaded", actorId: p.userId, actorName: p.actorName, visibility: p.visibility, at, payload: { documentId: id, filename: p.filename, kind: p.kind } });
  return { documentId: id, file };
}

export const isPublishableKind = (k: DocumentKind) => !INTERNAL_ONLY_DOCUMENT_KINDS.includes(k);

/** Parses a storage key into its segments; throws on invalid keys. */
export function parseKey(key: string) {
  assertValidKey(key);
  const [, orgId, entity, entityId, visibility, name] = key.split("/");
  return { orgId, entity, entityId, visibility: visibility as Visibility, name };
}

export async function fileById(db: DbOrTx, id: string) {
  const [f] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return f ?? null;
}

export async function getDbFile(id: string) { return fileById(await getDb(), id); }

/**
 * Mechanism 5 access rule for a storage key. Clients: same org AND `/client/` segment, or a `/client/` asset under
 * the agency org (catalog images, published shared PDFs). Ops: anything valid.
 */
export function canReadKey(ctx: { orgId: string; role: string }, key: string, agencyOrgId: string | null): boolean {
  let parsed: ReturnType<typeof parseKey>;
  try { parsed = parseKey(key); } catch { return false; }
  if (ctx.role === "admin" || ctx.role === "agent") return true;
  if (parsed.visibility !== "client") return false;
  return parsed.orgId === ctx.orgId || (!!agencyOrgId && parsed.orgId === agencyOrgId);
}

export async function agencyOrgId(db: DbOrTx): Promise<string | null> {
  const { organizations } = await import("@/db/schema/app");
  const [o] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.type, "agency")).limit(1);
  return o?.id ?? null;
}
