import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ClientCatalogRequestDto, ClientCatalogCategoryDto } from "@/server/client/dto/catalog";
import { ClientRangeDto, ClientRangeSummaryDto, ClientRangeRequestDto } from "@/server/client/dto/ranges";
import { extractPdfText } from "@/server/ops/ranges";
import { isDuplicateName, normaliseSupplierName } from "@/server/ops/suppliers";
import { leakCheck } from "@/server/shared/leak-check";

/**
 * F-11 / F-12 / F-21 / F-25 pure pieces: the new client DTOs are strict and supplier-free, the PDF text-layer extractor
 * feeds the leak check with what publish would see, and the supplier duplicate rule meets AC-SUP-03.
 * (The denylist walk in dto-denylist.test.ts picks up dto/catalog.ts and dto/ranges.ts automatically.)
 */
const fixtures = path.resolve(__dirname, "../../docs/fixtures");
const sources = { names: ["Qingdao Ecosino Industry Co., Ltd.", "Dongguan Yuantuo Packaging Products Co., Ltd."], handles: ["daryl_yt"], phones: ["+86 138 0000 0042"], contactNames: ["Daryl Yang"], usccs: ["91440300ZZLEAKTEST0"] };

describe("client catalog + range DTOs", () => {
  it("range DTO carries label + items + pdf only and rejects supplier keys", () => {
    const ok = ClientRangeDto.parse({
      id: crypto.randomUUID(), factoryLabel: "F-0042", yourProducts: ["Card sleeves"], orderRefs: ["ORD-2026-0312"], publishedAt: new Date().toISOString(),
      pdf: { filename: "Factory-F-0042-range.pdf", bytes: 1234, downloadUrl: "/api/files/org/x/factory_range/y/client/z.pdf" },
      items: [{ id: crypto.randomUUID(), name: "Toploader 55pt", image: null, moq: 20000, moqLabel: "MOQ 20,000", unit: "pcs", price: { minorE2: 1900, currency: "USD", unit: "pcs" }, madeHere: true, note: null }],
    });
    expect(ok.factoryLabel).toBe("F-0042");
    expect(() => ClientRangeDto.parse({ ...ok, supplierId: "leak" })).toThrow();
    expect(() => ClientRangeDto.parse({ ...ok, items: [{ ...ok.items[0], supplier_name: "Yuantuo" }] })).toThrow();
    expect(() => ClientRangeSummaryDto.parse({ id: crypto.randomUUID(), factoryLabel: "F-0042", href: "/app/ranges/x", itemCount: 1, yourProducts: [], orderRefs: [], publishedAt: new Date().toISOString(), image: null, preview: [], ref: "FR-0001" })).toThrow();
    expect(ClientRangeRequestDto.parse({ requestRef: "REQ-2026-0327", lineRefs: ["REQ-2026-0327-01"], factoryLabel: "F-0042" }).lineRefs).toHaveLength(1);
  });
  it("catalog request DTO is strict", () => {
    expect(ClientCatalogRequestDto.parse({ requestRef: "REQ-2026-0327", lineRef: "REQ-2026-0327-01", productRef: "PRD-0001", name: "Shelving", qty: 500, unit: "set" }).qty).toBe(500);
    expect(() => ClientCatalogRequestDto.parse({ requestRef: "x", lineRef: "y", productRef: "z", name: "n", qty: 0, unit: "set" })).toThrow();
    expect(() => ClientCatalogCategoryDto.parse({ category: "garden", count: 1, owner_org_id: "x" })).toThrow();
  });
});

describe("factory range publish: PDF text layer → leak check (AC-RNG-05)", () => {
  it("extracts the text of the seeded fixtures", () => {
    expect(extractPdfText(readFileSync(path.join(fixtures, "leaky-range.pdf")))).toContain("Qingdao Ecosino");
    expect(extractPdfText(readFileSync(path.join(fixtures, "clean-range.pdf")))).not.toContain("Ecosino");
  });
  it("blocks the leaky range and passes the clean one", () => {
    const leaky = leakCheck({ pdfText: extractPdfText(readFileSync(path.join(fixtures, "leaky-range.pdf"))) }, sources);
    expect(leaky.ok).toBe(false);
    if (!leaky.ok) expect(leaky.hits.some((h) => h.kind === "supplier_name" && h.where === "pdf_text")).toBe(true);
    expect(leakCheck({ pdfText: extractPdfText(readFileSync(path.join(fixtures, "clean-range.pdf"))), fields: { "item 1 name": "Toploader 55pt", "item 1 note": "sourced by them" }, filenames: ["Factory-F-0043-range.pdf"] }, sources).ok).toBe(true);
  });
  it("item text is checked field by field", () => {
    const r = leakCheck({ fields: { "item 3 name": "Deck box (Yuantuo original)", "item 3 note": null } }, sources);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hits[0].where).toBe("item 3 name");
  });
  it("returns an empty string for a PDF without a text layer", () => {
    expect(extractPdfText(Buffer.from("%PDF-1.4 nothing here"))).toBe("");
  });
});

describe("supplier duplicate rule (AC-SUP-03)", () => {
  it("normalises Co Ltd variants and punctuation", () => {
    expect(normaliseSupplierName("Dongguan Yuantuo Packaging Products Co., Ltd.")).toBe("dongguan yuantuo packaging products");
    expect(normaliseSupplierName("DONGGUAN YUANTUO PACKAGING PRODUCTS CO LTD")).toBe("dongguan yuantuo packaging products");
  });
  it("flags the sheet's spelling of an existing factory", () => {
    expect(isDuplicateName("Dongguan Yuantuo Packaging Co Ltd", "Dongguan Yuantuo Packaging Products Co., Ltd.")).toBe(true);
    expect(isDuplicateName("Qingdao Ecosino Industry", "Qingdao Ecosino Industry Co., Ltd.")).toBe(true);
  });
  it("does not flag a different factory in the same city and trade", () => {
    expect(isDuplicateName("Dongguan Brightway Packaging Co., Ltd.", "Dongguan Yuantuo Packaging Products Co., Ltd.")).toBe(false);
    expect(isDuplicateName("Qingdao Xinyi Metal Products Co., Ltd.", "Qingdao Ecosino Industry Co., Ltd.")).toBe(false);
  });
});
