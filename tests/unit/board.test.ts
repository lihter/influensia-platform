import { describe, it, expect } from "vitest";
import { specCompleteness, summariseSpec, targetPriceE2, defaultEstE2, prefillClientPriceE2, prefillFeeMinor, ladderPriceAt, compactQty, parsePriceE2, parseAmountMinor, REASON_REQUIRED } from "@/components/ops/board/pure";
import { ClientLinePageDto, ClientLineOfferCardDto } from "@/server/client/dto/lines";
import { normaliseQuote } from "@/server/shared/compare";

describe("spec completeness gate (SPEC F-15)", () => {
  it("lists every missing item (AC-SPEC-01)", () => {
    const g = specCompleteness({ name: "LED floodlight", category: null, unit: null, fieldCount: 0, imageCount: 0, linkCount: 1, qty: 300 });
    expect(g.ok).toBe(false);
    expect(g.missing).toEqual(["category", "unit", "spec fields (0 of 3)"]);
  });
  it("passes with name, category, unit, 3 fields, a link and qty (AC-SPEC-02)", () => {
    expect(specCompleteness({ name: "LED floodlight", category: "lighting", unit: "pcs", fieldCount: 3, imageCount: 0, linkCount: 1, qty: 300 })).toEqual({ ok: true, missing: [] });
    expect(specCompleteness({ name: "x", category: "lighting", unit: "pcs", fieldCount: 3, imageCount: 0, linkCount: 0, qty: 300 }).missing).toEqual(["an image or a link"]);
    expect(specCompleteness({ name: "x", category: "lighting", unit: "pcs", fieldCount: 3, imageCount: 1, linkCount: 0, qty: 0 }).missing).toEqual(["quantity"]);
  });
  it("summarises fields client-safely", () => {
    expect(summariseSpec({ size: "66×91 mm", thickness: "100 µm single wall", material: "PP virgin", "PVC-free": true })).toBe("size 66×91 mm, thickness 100 µm single wall, material PP virgin, PVC-free");
  });
});

describe("cost model & target (SPEC F-16)", () => {
  it("AC-COST-01: est 0.031 × 1.20 → 0.037 (4 dp)", () => {
    expect(targetPriceE2(310, 20)).toBe(372); // $0.0372 → displayed $0.0372; seed stores 0.037
    expect(defaultEstE2(40, 200, 40, 10)).toBe(308); // (0.004+0.020+0.004)×1.10 = 0.0308
  });
  it("AC-COST-02: est $9.50 with uplift 20 → $11.40", () => {
    expect(targetPriceE2(95000, 20)).toBe(114000);
  });
});

describe("offer prefill (SPEC F-18)", () => {
  it("AC-OFB-02: 0.052 + 15 % margin at 4 dp → 0.0598", () => {
    expect(prefillClientPriceE2(520, 15, 4)).toBe(598);
  });
  it("rounds per the pricing rule decimals", () => {
    expect(prefillClientPriceE2(84000, 18, 2)).toBe(99100); // 8.40 × 1.18 = 9.912 → 9.91
    expect(prefillClientPriceE2(2050, 20, 3)).toBe(2460); // 0.205 × 1.2 = 0.246
  });
  it("fee = fee % of ladder total at qty", () => {
    expect(prefillFeeMinor(620, 100000, 10)).toBe(62000); // 0.062 × 100 000 = $6,200 → 10 % = $620.00
  });
  it("ladder price at qty picks the largest break ≤ qty", () => {
    const ladder = [{ min_qty: 50000, unit_price_minor_e2: 490 }, { min_qty: 100000, unit_price_minor_e2: 460 }];
    expect(ladderPriceAt(ladder, 100000)).toBe(460);
    expect(ladderPriceAt(ladder, 60000)).toBe(490);
    expect(ladderPriceAt(ladder, 10)).toBe(490);
    expect(ladderPriceAt([], 10)).toBeNull();
  });
});

describe("board helpers", () => {
  it("compact qty + parsers", () => {
    expect(compactQty(100000)).toBe("100k");
    expect(compactQty(3000)).toBe("3k");
    expect(compactQty(1500)).toBe("1.5k");
    expect(compactQty(500)).toBe("500");
    expect(parsePriceE2("0.0539")).toBe(539);
    expect(parsePriceE2("0,049")).toBe(490);
    expect(parsePriceE2("abc")).toBeNull();
    expect(parseAmountMinor("540")).toBe(54000);
    expect(parseAmountMinor("45.00")).toBe(4500);
  });
  it("reason is required for shortlisted / dropped / cannot_make / backup (AC-BOARD-05)", () => {
    expect([...REASON_REQUIRED].sort()).toEqual(["backup", "cannot_make", "dropped", "shortlisted"]);
  });
  it("AC-BOARD-03/04: normalisation at line qty and CNY → USD", () => {
    const fx = (c: string) => (c === "CNY" ? 6.6933 : null);
    const boyuan = normaliseQuote({ currency: "USD", unit: "pcs", breaks: [{ minQty: 50000, unitPriceMinorE2: 490 }, { minQty: 100000, unitPriceMinorE2: 460 }], validUntil: "2026-10-31" }, { qty: 100000, unit: "pcs" }, fx, new Date("2026-09-28T09:00:00Z"));
    expect(boyuan.usdMinorE2).toBe(460);
    const cny = normaliseQuote({ currency: "CNY", unit: "pcs", breaks: [{ minQty: 100000, unitPriceMinorE2: 2400 }] }, { qty: 100000, unit: "pcs" }, fx, new Date("2026-09-28T09:00:00Z"));
    expect(cny.usdMinorE2).toBe(359); // ¥0.24 / 6.6933 = $0.0359
  });
});

describe("client line page DTO (mechanism 2/3)", () => {
  it("is strict at the top level and rejects supplier-shaped keys", () => {
    expect(() => ClientLinePageDto.parse({ supplierName: "x" })).toThrow();
    expect(() => ClientLineOfferCardDto.parse({ ref: "OFR", href: "/x", version: 1, status: "sent", validUntil: null, acceptedOptionLabel: null, unitPrice: null, fee: null, moq: null, leadDays: null, decidedAt: null, participationId: "leak" })).toThrow();
  });
});
