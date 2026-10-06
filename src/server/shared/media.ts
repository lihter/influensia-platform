/**
 * Product pictures for lists and headers — one implementation for both audiences ("the picture leads, the title
 * follows"). Every function is batched: one query per source for a whole table, never one per row.
 *
 * Audience policy (what may be shown):
 *   client — the line's own org only; client-visible documents and clean catalog images; EXIF-stripped files under a
 *            `/client/` key (SPEC 5.6). App schema only — never supplier data.
 *   ops    — any live image on the line or product, internal ones included.
 *
 * Preference per line: catalog clean image → client reference photo → production photo → sample photo →
 * (ops only) other product images (client reference / supplier-facing).
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { documents, files, productImages, requestLines } from "@/db/schema/app";

export type Thumb = { id: string; url: string };
/** One picture of a multi-product row (order, request, range) — name kept for alt text and hover preview. */
export type MediaItem = { name: string; image: Thumb | null };
export type MediaAudience = { kind: "ops" } | { kind: "client"; orgId: string };

export const OPS_MEDIA: MediaAudience = { kind: "ops" };
/** How many pictures a multi-product row carries (the stack shows 3 + "+N"). */
export const MEDIA_STACK_MAX = 4;

const RANK = { clean: 0, reference_image: 1, production_photo: 2, sample_photo: 3, client_reference: 4, supplier_facing: 5 } as const;
const LINE_PHOTO_KINDS = ["reference_image", "production_photo", "sample_photo"] as const;
type Kind = keyof typeof RANK;

export const fileUrl = (storageKey: string) => `/api/files/${storageKey}`;
const isClientKey = (key: string) => key.split("/")[4] === "client";

/** Keeps the best-ranked picture per owner id. */
class Picker {
  private best = new Map<string, { rank: number; thumb: Thumb }>();
  offer(owner: string, kind: Kind, id: string, storageKey: string) {
    const rank = RANK[kind];
    const cur = this.best.get(owner);
    if (!cur || rank < cur.rank) this.best.set(owner, { rank, thumb: { id, url: fileUrl(storageKey) } });
  }
  result(): Map<string, Thumb> { return new Map([...this.best].map(([k, v]) => [k, v.thumb])); }
}

async function productImageRows(db: DbOrTx, productIds: string[], audience: MediaAudience) {
  if (!productIds.length) return [];
  const client = audience.kind === "client";
  const rows = await db
    .select({ productId: productImages.productId, id: productImages.id, kind: productImages.kind, storageKey: files.storageKey, mime: files.mime })
    .from(productImages).innerJoin(files, eq(files.id, productImages.fileId))
    .where(and(inArray(productImages.productId, productIds), client ? and(eq(productImages.kind, "clean"), eq(files.exifStripped, true)) : undefined))
    .orderBy(asc(productImages.createdAt));
  return rows.filter((r) => r.mime.startsWith("image/") && (!client || isClientKey(r.storageKey)));
}

/** product id → its best picture. */
export async function productThumbs(db: DbOrTx, productIds: readonly string[], audience: MediaAudience): Promise<Map<string, Thumb>> {
  const pick = new Picker();
  for (const r of await productImageRows(db, [...new Set(productIds)], audience)) pick.offer(r.productId, r.kind, r.id, r.storageKey);
  return pick.result();
}

/** request line id → its best picture. For clients, lines of other orgs are ignored. */
export async function lineThumbs(db: DbOrTx, lineIds: readonly string[], audience: MediaAudience): Promise<Map<string, Thumb>> {
  const ids = [...new Set(lineIds)];
  if (!ids.length) return new Map();
  const client = audience.kind === "client";
  const lines = await db.select({ id: requestLines.id, productId: requestLines.productId }).from(requestLines)
    .where(and(inArray(requestLines.id, ids), client ? eq(requestLines.orgId, audience.orgId) : undefined));
  if (!lines.length) return new Map();
  const lineIdsOk = lines.map((l) => l.id);
  const productIds = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];

  const [productRows, docRows] = await Promise.all([
    productImageRows(db, productIds, audience),
    db.select({ id: documents.id, lineId: documents.entityId, kind: documents.kind, storageKey: files.storageKey, mime: files.mime })
      .from(documents).innerJoin(files, eq(files.id, documents.fileId))
      .where(and(
        eq(documents.entityType, "request_line"), inArray(documents.entityId, lineIdsOk), inArray(documents.kind, [...LINE_PHOTO_KINDS]), isNull(documents.deletedAt),
        client ? and(eq(documents.orgId, audience.orgId), eq(documents.visibility, "client"), eq(files.exifStripped, true)) : undefined,
      ))
      .orderBy(asc(documents.createdAt)),
  ]);

  const pick = new Picker();
  const byProduct = new Map<string, typeof productRows>();
  for (const r of productRows) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
  for (const l of lines) for (const r of (l.productId && byProduct.get(l.productId)) || []) pick.offer(l.id, r.kind, r.id, r.storageKey);
  for (const d of docRows) {
    if (!d.mime.startsWith("image/") || (client && !isClientKey(d.storageKey))) continue;
    pick.offer(d.lineId, d.kind as Kind, d.id, d.storageKey);
  }
  return pick.result();
}

/** file id → picture, for rows that point at a file directly (range items). Ops audience only. */
export async function fileThumbs(db: DbOrTx, fileIds: readonly (string | null | undefined)[]): Promise<Map<string, Thumb>> {
  const ids = [...new Set(fileIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: files.id, storageKey: files.storageKey, mime: files.mime }).from(files).where(inArray(files.id, ids));
  return new Map(rows.filter((r) => r.mime.startsWith("image/")).map((r) => [r.id, { id: r.id, url: fileUrl(r.storageKey) }]));
}

/** First `max` lines of a multi-product row as pictures, in the given order. */
export function mediaItems(lines: readonly { id: string; name: string }[], thumbs: Map<string, Thumb>, max = MEDIA_STACK_MAX): MediaItem[] {
  return lines.slice(0, max).map((l) => ({ name: l.name, image: thumbs.get(l.id) ?? null }));
}
