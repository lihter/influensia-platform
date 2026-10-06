/**
 * Product pictures for client lists (tables lead with the image — a photo says more than any title).
 * Source order per request line:
 *   1. the linked catalog product's clean image (product_images.kind = clean)
 *   2. the client's own reference photo on the line (documents.kind = reference_image)
 *   3. a production / sample photo we published on the line
 * Only EXIF-stripped files stored under a `/client/` key are ever returned (SPEC 5.6) — app schema only.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { documents, files, productImages, requestLines } from "@/db/schema/app";
import { ClientProductImageDto } from "./dto/product";

const LINE_PHOTO_KINDS = ["reference_image", "production_photo", "sample_photo"] as const;
const RANK: Record<string, number> = { product: 0, reference_image: 1, production_photo: 2, sample_photo: 3 };
const isClientKey = (key: string) => key.split("/")[4] === "client";

type Pick = { rank: number; image: ClientProductImageDto };

/** line id → its best client-visible picture. Lines of other orgs are ignored. */
export async function lineThumbnails(db: DbOrTx, orgId: string, lineIds: string[]): Promise<Map<string, ClientProductImageDto>> {
  const out = new Map<string, Pick>();
  const ids = [...new Set(lineIds)];
  if (!ids.length) return new Map();
  const lines = await db.select({ id: requestLines.id, productId: requestLines.productId }).from(requestLines).where(and(eq(requestLines.orgId, orgId), inArray(requestLines.id, ids)));
  const offer = (lineId: string, rank: number, id: string, storageKey: string) => {
    const cur = out.get(lineId);
    if (cur && cur.rank <= rank) return;
    out.set(lineId, { rank, image: ClientProductImageDto.parse({ id, url: `/api/files/${storageKey}` }) });
  };

  const productIds = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
  if (productIds.length) {
    const rows = await db
      .select({ productId: productImages.productId, id: productImages.id, storageKey: files.storageKey })
      .from(productImages).innerJoin(files, eq(files.id, productImages.fileId))
      .where(and(inArray(productImages.productId, productIds), eq(productImages.kind, "clean"), eq(files.exifStripped, true)))
      .orderBy(asc(productImages.createdAt));
    for (const l of lines) {
      const first = rows.find((r) => r.productId === l.productId && isClientKey(r.storageKey));
      if (first) offer(l.id, RANK.product, first.id, first.storageKey);
    }
  }

  const docs = await db
    .select({ id: documents.id, entityId: documents.entityId, kind: documents.kind, storageKey: files.storageKey, mime: files.mime })
    .from(documents).innerJoin(files, eq(files.id, documents.fileId))
    .where(and(
      eq(documents.orgId, orgId), eq(documents.entityType, "request_line"), inArray(documents.entityId, lines.map((l) => l.id)),
      eq(documents.visibility, "client"), inArray(documents.kind, [...LINE_PHOTO_KINDS]), eq(files.exifStripped, true), isNull(documents.deletedAt),
    ))
    .orderBy(asc(documents.createdAt));
  for (const d of docs) {
    if (!d.mime.startsWith("image/") || !isClientKey(d.storageKey)) continue;
    offer(d.entityId, RANK[d.kind] ?? 9, d.id, d.storageKey);
  }
  return new Map([...out].map(([k, v]) => [k, v.image]));
}

/** "allegro.pl" from the first client link — shown under the placeholder when there is no photo yet. */
export function linkDomain(links: string[]): string | null {
  for (const u of links) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { /* not a URL */ }
  }
  return null;
}
