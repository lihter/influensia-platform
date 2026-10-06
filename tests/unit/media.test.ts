/**
 * Product pictures (src/server/shared/media.ts, src/lib/media.ts, image-variants): the audience policy is the
 * anonymity-critical part — a client must never get an internal photo or another org's photo, while ops sees every
 * live image. Runs against a freshly seeded PGlite (~10 s).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { linkDomain, thumbUrl, thumbWidthFor, isThumbWidth } from "@/lib/media";

vi.setConfig({ testTimeout: 180_000 });

const dir = mkdtempSync(path.join(tmpdir(), "media-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.FILES_DIR = path.join(dir, "files");
process.env.OUTBOX_LOG = path.join(dir, "outbox.log");
process.env.SEED_CLOCK = "2026-09-28T09:00:00Z";
process.env.SEED_SHIFT_DAYS = "0";
delete process.env.DATABASE_URL;

describe("image URL helpers", () => {
  it("picks the smallest rendered width that is sharp on a 2× screen", () => {
    expect(thumbWidthFor(40)).toBe(96);
    expect(thumbWidthFor(56)).toBe(160);
    expect(thumbWidthFor(96)).toBe(320);
    expect(thumbWidthFor(256)).toBe(640);
    expect(thumbWidthFor(2000)).toBe(640);
    expect(isThumbWidth(160)).toBe(true);
    expect(isThumbWidth(161)).toBe(false);
  });
  it("only rewrites our own file URLs", () => {
    expect(thumbUrl("/api/files/org/a/b/c/client/d.jpg", 56)).toBe("/api/files/org/a/b/c/client/d.jpg?w=160");
    expect(thumbUrl("/api/files/x.jpg?dl=1", 40)).toBe("/api/files/x.jpg?dl=1&w=96");
    expect(thumbUrl("https://cdn.example.com/p.jpg", 56)).toBe("https://cdn.example.com/p.jpg");
  });
  it("derives the shop domain from the first parsable link", () => {
    expect(linkDomain(["not a url", "https://www.allegro.pl/oferta/123"])).toBe("allegro.pl");
    expect(linkDomain([])).toBeNull();
    expect(linkDomain(null)).toBeNull();
  });
});

describe("audience policy + variants (seeded db)", () => {
  type Db = Awaited<ReturnType<typeof import("@/db").getDb>>;
  let db: Db;
  let lineId: string, orgId: string, otherOrgId: string;
  let internalDocId: string, clientDocId: string;
  let jpeg: Buffer;

  beforeAll(async () => {
    const { seed } = await import("@/db/seed");
    await seed();
    db = await (await import("@/db")).getDb();
    const S = await import("@/db/schema/app");
    const D = await import("drizzle-orm");
    const sharp = (await import("sharp")).default;
    jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#c0392b" } }).jpeg().toBuffer();

    // a line without a catalog product, so only line documents can supply its picture
    const [l] = await db.select().from(S.requestLines).where(D.isNull(S.requestLines.productId)).limit(1);
    lineId = l.id; orgId = l.orgId;
    const [other] = await db.select().from(S.organizations).where(D.and(D.eq(S.organizations.type, "client"), D.ne(S.organizations.id, orgId))).limit(1);
    otherOrgId = other.id;
    // drop seeded photos on this line so the assertions see only ours
    await db.update(S.documents).set({ deletedAt: new Date() }).where(D.and(D.eq(S.documents.entityId, lineId), D.inArray(S.documents.kind, ["reference_image", "production_photo", "sample_photo"])));

    const { storeDocument } = await import("@/server/shared/files");
    const base = { orgId, userId: null, data: jpeg, mime: "image/jpeg", entity: "request_line" as const, entityId: lineId };
    internalDocId = (await storeDocument(db, { ...base, filename: "factory-floor.jpg", kind: "production_photo", visibility: "internal" })).documentId;
  }, 600_000);

  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* PGlite may still hold files */ } });

  it("ops sees an internal photo; the client does not", async () => {
    const { lineThumbs, OPS_MEDIA } = await import("@/server/shared/media");
    expect((await lineThumbs(db, [lineId], OPS_MEDIA)).get(lineId)?.id).toBe(internalDocId);
    expect((await lineThumbs(db, [lineId], { kind: "client", orgId })).has(lineId)).toBe(false);
  });

  it("a client-visible reference photo wins for both audiences, and only for the owning org", async () => {
    const { storeDocument } = await import("@/server/shared/files");
    clientDocId = (await storeDocument(db, { orgId, userId: null, data: jpeg, mime: "image/jpeg", filename: "my-photo.jpg", entity: "request_line", entityId: lineId, kind: "reference_image", visibility: "client" })).documentId;
    const { lineThumbs, OPS_MEDIA } = await import("@/server/shared/media");
    const client = (await lineThumbs(db, [lineId], { kind: "client", orgId })).get(lineId);
    expect(client?.id).toBe(clientDocId);
    expect(client?.url).toMatch(/^\/api\/files\/org\/.+\/client\/.+\.jpg$/);
    expect((await lineThumbs(db, [lineId], OPS_MEDIA)).get(lineId)?.id).toBe(clientDocId); // reference photo outranks production photo
    expect((await lineThumbs(db, [lineId], { kind: "client", orgId: otherOrgId })).size).toBe(0);
  });

  it("mediaItems keeps line order and caps the stack", async () => {
    const { mediaItems } = await import("@/server/shared/media");
    const t = new Map([["a", { id: "1", url: "/api/files/a" }]]);
    const items = mediaItems([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }, { id: "e", name: "E" }], t);
    expect(items.map((i) => i.name)).toEqual(["A", "B", "C", "D"]);
    expect(items[0].image?.url).toBe("/api/files/a");
    expect(items[1].image).toBeNull();
  });

  it("renders a small square WebP variant and serves repeats from cache", async () => {
    const { imageVariant } = await import("@/server/shared/image-variants");
    const { getStorage } = await import("@/server/shared/storage");
    const S = await import("@/db/schema/app");
    const D = await import("drizzle-orm");
    const [row] = await db.select({ key: S.files.storageKey }).from(S.documents).innerJoin(S.files, D.eq(S.files.id, S.documents.fileId)).where(D.eq(S.documents.id, clientDocId));
    let loads = 0;
    const load = () => { loads++; return getStorage().get(row.key); };
    const out = await imageVariant(row.key, 160, load);
    const meta = await (await import("sharp")).default(out!).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(160);
    expect(meta.height).toBe(160);
    expect(out!.length).toBeLessThan(jpeg.length / 4);
    await imageVariant(row.key, 160, load);
    expect(loads).toBe(1);
  });
});
