import { describe, it, expect } from "vitest";
import { extractUrls, cleanUrl, isNotDurable, titleFromUrl, titleFromFilename, parseLink } from "@/components/app/requests/link-parse";
import { parseCsv, rowsFromGrid } from "@/components/app/requests/import-parse";
import { NewRequestSchema } from "@/server/client/requests";
import { ClientListRowDto, ClientRequestCreatedDto } from "@/server/client/dto/requests";

describe("paste-and-go link parsing (SPEC F-04)", () => {
  it("splits on newlines / whitespace, keeps http(s) only, dedupes after cleaning", () => {
    const text = `https://allegro.pl/oferta/a-b-123?srsltid=x\n https://allegro.pl/oferta/a-b-123?utm_source=g \nftp://nope\nnot a url\nhttps://allegro.pl/oferta/a-b-123`;
    expect(extractUrls(text)).toEqual(["https://allegro.pl/oferta/a-b-123"]);
  });
  it("strips tracking params but keeps meaningful ones and drops the hash", () => {
    expect(cleanUrl("https://x.com/p?id=5&utm_campaign=a&fbclid=b&ck=1&ckvia=2&srsltid=3#top")).toBe("https://x.com/p?id=5");
    expect(cleanUrl("https://x.com/p?utm_source=a")).toBe("https://x.com/p");
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
  });
  it("flags share links as not durable", () => {
    expect(isNotDurable("https://share.google/abc")).toBe(true);
    expect(isNotDurable("https://vm.tiktok.com/ZM1/")).toBe(true);
    expect(isNotDurable("https://www.facebook.com/share/p/abc/")).toBe(true);
    expect(isNotDurable("https://www.alibaba.com/?from=share")).toBe(true);
    expect(isNotDurable("https://www.alibaba.com/product-detail/x_1601.html")).toBe(false);
    expect(isNotDurable("https://allegro.pl/oferta/x-1")).toBe(false);
  });
  it("derives a readable title from the slug, dropping ids, uuids and stop segments", () => {
    expect(titleFromUrl("https://allegro.pl/oferta/rekawiczki-rekawice-robocze-r10-latex-12539547048?x=1")).toBe("Rekawiczki rekawice robocze r10 latex");
    expect(titleFromUrl("https://allegro.pl/produkt/lampa-na-stojaku-smartled-150w-214f71dc-85af-4abb-a679-953740ee42fc")).toBe("Lampa na stojaku smartled 150w");
    expect(titleFromUrl("https://www.alibaba.com/product-detail/ultralight-camping-chair_1601234567890.html")).toBe("Ultralight camping chair");
    expect(titleFromUrl("https://www.amazon.de/dp/B0CXYZ1234")).toBe("amazon.de");
    expect(titleFromUrl("https://vm.tiktok.com/ZMabc/")).toBe("vm.tiktok.com");
    expect(titleFromFilename("IMG_2024-09-01_kitchen-rack.jpg")).toBe("IMG 2024 09 01 kitchen rack");
  });
  it("parseLink returns the full record", () => {
    expect(parseLink("https://allegro.pl/oferta/team-bag-66x91-15866789012?srsltid=1")).toEqual({ url: "https://allegro.pl/oferta/team-bag-66x91-15866789012", domain: "allegro.pl", notDurable: false, title: "Team bag 66x91" });
  });
});

describe("CSV / xlsx import (SPEC F-04 xlsx stub, AC-NEW-05/06)", () => {
  it("parses the order312 fixture shape (Name,Link,Qty) into rows with quantities", () => {
    const csv = 'Name,Link,Qty\n"Standard sleeves 66×91 mm, 100 µm, PP, 100/bag",,100000\n"Toploader 130pt",https://allegro.pl/oferta/toploader-1,5000\n';
    const r = rowsFromGrid(parseCsv(csv), "order312");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ name: "Standard sleeves 66×91 mm, 100 µm, PP, 100/bag", link: null, qty: 100000, note: null });
    expect(r.rows[1].link).toBe("https://allegro.pl/oferta/toploader-1");
    expect(r.rows[1].qty).toBe(5000);
  });
  it("accepts product/quantity/url aliases, semicolons, a header not on the first row, and grouped numbers", () => {
    const csv = "Export 2026;;\nProduct;URL;Quantity;Note\nGloves;https://x.pl/a;10 000;red\n";
    const r = rowsFromGrid(parseCsv(csv));
    expect(r.ok && r.rows[0]).toEqual({ name: "Gloves", link: "https://x.pl/a", qty: 10000, note: "red" });
  });
  it("fails with no_header when neither name nor product is present (→ fallback attach)", () => {
    expect(rowsFromGrid(parseCsv("a,b,c\n1,2,3\n"))).toEqual({ ok: false, reason: "no_header" });
    expect(rowsFromGrid([])).toEqual({ ok: false, reason: "empty" });
  });
});

describe("NewRequestSchema (server-side validation)", () => {
  it("requires a quantity ≥ 1 and a name of 2–200 chars, max 50 lines", () => {
    const ok = NewRequestSchema.safeParse({ lines: [{ name: "Gloves", qty: "10", links: ["https://x.pl/a"] }] });
    expect(ok.success).toBe(true);
    if (ok.success) { expect(ok.data.lines[0].qty).toBe(10); expect(ok.data.lines[0].unit).toBe("pcs"); expect(ok.data.draft).toBe(false); expect(ok.data.source).toBe("portal"); }
    const bad = NewRequestSchema.safeParse({ lines: [{ name: "G", qty: 0 }] });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.map((i) => i.path.join("."))).toEqual(expect.arrayContaining(["lines.0.name", "lines.0.qty"]));
    const many = NewRequestSchema.safeParse({ lines: Array.from({ length: 51 }, () => ({ name: "Item", qty: 1 })) });
    expect(many.success).toBe(false);
    expect(NewRequestSchema.safeParse({ lines: [] }).success).toBe(false);
  });
});

describe("requests DTOs", () => {
  it("list row is strict and rejects supplier-shaped keys", () => {
    const base = { id: crypto.randomUUID(), ref: "REQ-2026-0312-01", requestRef: "REQ-2026-0312", orderRef: "ORD-2026-0312", displayRef: "ORD-2026-0312 · line 01", href: "/app/orders/ORD-2026-0312", name: "Sleeves", qty: 100000, unit: "pcs", state: "in_production", milestone: "in_production", milestoneStep: 6, subLabel: "In production", exception: null, exceptionText: null, waitingReason: null, sourcingProgress: { reached: 3, priced: 2 }, etaLabel: "ETA Gdańsk 18 Nov 2026", isRepeat: false, isDraft: false, isClosed: false, updatedAt: new Date().toISOString(), lastChangeAt: new Date().toISOString(), milestoneLabel: "In production", offerOutcome: null };
    expect(ClientListRowDto.parse(base)).toMatchObject({ displayRef: "ORD-2026-0312 · line 01" });
    expect(() => ClientListRowDto.parse({ ...base, supplierName: "leak" })).toThrow();
    expect(() => ClientRequestCreatedDto.parse({ id: crypto.randomUUID(), ref: "REQ-2026-0326", lineCount: 2, draft: false, href: "/app/requests/REQ-2026-0326", participationId: "x" })).toThrow();
  });
});
