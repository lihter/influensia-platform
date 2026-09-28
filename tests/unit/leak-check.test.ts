import { describe, it, expect } from "vitest";
import { leakCheck, stripCompanySuffix, assertClean, LeakCheckError } from "@/server/shared/leak-check";

const sources = {
  names: ["ZZLEAKTEST Co., Ltd.", "ZZ泄漏测试有限公司", "Dongguan Yuantuo Packaging Products Co., Ltd.", "东莞市源拓包装制品有限公司", "Yiwu Suti Crafts Co., Ltd.", "Yili (依立) — verify legal name", "Unidentified — Quote D (verify)"],
  handles: ["zzleaktest_wx", "daryl_yt", "https://zzleaktest.en.alibaba.com", "tim-suti"],
  phones: ["+86 138 0000 0042", "13318425160"],
  contactNames: ["Daryl Yang", "Leak Tester", "Cathy", "John"],
  usccs: ["91440300ZZLEAKTEST0"],
};

describe("leakCheck (SPEC B.5)", () => {
  it("passes clean client text and the exempt literals", () => {
    expect(leakCheck({ text: "QC passed on 22 Sep, 0 critical, 2 minor. Report attached." }, sources)).toEqual({ ok: true });
    expect(leakCheck({ text: "Factory F-0042 — the factory making your sleeves, shipped from China via Shenzhen" }, sources)).toEqual({ ok: true });
    expect(leakCheck({ text: "USD for now; EUR display is coming." }, sources)).toEqual({ ok: true });
    expect(leakCheck({ text: "Deposit and fee received, artwork approved — production starts" }, sources)).toEqual({ ok: true });
    expect(leakCheck({ text: "Please verify the legal size and quote again" }, sources).ok, "generic words from junk supplier names must not fire").toBe(true);
  });
  it("catches supplier legal name, stripped name, distinctive token and CN name", () => {
    expect(leakCheck({ text: "sample from zzleaktest co ltd" }, sources).ok).toBe(false);
    expect(leakCheck({ text: "Yuantuo confirmed the mould" }, sources).ok).toBe(false);
    expect(leakCheck({ text: "as YUANTUO confirmed" }, sources).ok).toBe(false);
    expect(leakCheck({ text: "由东莞市源拓包装制品生产" }, sources).ok).toBe(false);
    expect(leakCheck({ text: "Quoted by Yiwu Suti Crafts" }, sources).ok).toBe(false);
    expect(stripCompanySuffix("Dongguan Yuantuo Packaging Products Co., Ltd.")).toBe("dongguan yuantuo packaging products");
    expect(stripCompanySuffix("东莞市源拓包装制品有限公司")).toBe("东莞市源拓包装制品");
  });
  it("catches handles, +86 numbers (any spacing), contact names, USCC", () => {
    expect(leakCheck({ text: "wechat me: zzleaktest_wx" }, sources).ok).toBe(false);
    expect(leakCheck({ text: "call +86 138 0000 0042" }, sources).ok).toBe(false);
    expect(leakCheck({ text: "call 13800000042 now" }, sources).ok).toBe(false);
    expect(leakCheck({ text: "Daryl Yang will ship on Monday" }, sources).ok).toBe(false);
    expect(leakCheck({ text: "Cathy will ship on Monday" }, sources).ok, "common first names alone do not fire").toBe(true);
    expect(leakCheck({ text: "registered 91440300ZZLEAKTEST0" }, sources).ok).toBe(false);
  });
  it("catches generic patterns: platform URLs, wechat/微信, Co., Ltd, 有限公司, SUP-/PO-/FR- refs", () => {
    const r = leakCheck({ text: "see https://www.alibaba.com/product-detail/x_1600.html or 1688.com, 微信 ok, Foshan Bright Star Co., Ltd, 佛山明星有限公司, SUP-0007, PO-2026-0312-01, FR-0001" }, sources);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const kinds = new Set(r.hits.map((h) => h.kind));
      expect(kinds.has("url")).toBe(true);
      expect(kinds.has("wechat")).toBe(true);
      expect(kinds.has("company_suffix")).toBe(true);
      expect(kinds.has("ref")).toBe(true);
      expect(r.hits.some((h) => h.match === "SUP-0007")).toBe(true);
      expect(r.hits.some((h) => h.match === "PO-2026-0312-01")).toBe(true);
    }
  });
  it("scans filenames, pdf text, named fields, and decoded copies", () => {
    const r = leakCheck({ filenames: ["ZZLEAKTEST price list.pdf"], pdfText: "clean body", fields: { deviations: "Quoted by Yiwu Suti Crafts" } }, sources);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.hits.some((h) => h.where === "filename")).toBe(true);
      expect(r.hits.some((h) => h.where === "deviations" && h.kind === "supplier_name")).toBe(true);
    }
    expect(leakCheck({ text: "https%3A%2F%2Fzzleaktest.en.alibaba.com" }, sources).ok).toBe(false);
    expect(leakCheck({ text: "&#90;&#90;LEAKTEST Co., Ltd" }, sources).ok).toBe(false);
    expect(() => assertClean({ text: "ZZLEAKTEST" }, sources)).toThrow(LeakCheckError);
  });
});
