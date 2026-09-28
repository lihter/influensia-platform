import { describe, it, expect } from "vitest";
import { leakCheck, stripCompanySuffix, assertClean, LeakCheckError, cnShortNames, enShortNames, contactTokens, normaliseLoadingPort, type LeakSources } from "@/server/shared/leak-check";

/** Mirrors the seeded supplier data (SPEC 7.4) closely enough to exercise every rule. */
const sources: LeakSources = {
  names: [
    "ZZLEAKTEST Co., Ltd.", "ZZ泄漏测试有限公司", "Dongguan Yuantuo Packaging Products Co., Ltd.", "东莞市源拓包装制品有限公司", "Yiwu Suti Crafts Co., Ltd.", "义乌市苏媞工艺品有限公司",
    "Yili (依立) — verify legal name", "依立", "Unidentified — Quote D (verify)", "Linyi Tongfu Safety Products Co., Ltd.", "临沂通福劳保用品有限公司", "Guangdong Dr. Card Culture Co., Ltd.",
    "Taizhou Sunshine Garden Products Co., Ltd.", "Zhongshan Jinou Hardware Products Co., Ltd.", "中山金瓯五金制品有限公司", "Yiwu Mali Tree Co., Ltd.", "Nantong Stylish Lighting Co., Ltd.",
  ],
  handles: ["zzleaktest_wx", "daryl_yt", "https://zzleaktest.en.alibaba.com", "tim-suti", "xinhong1688"],
  phones: ["+86 138 0000 0042", "13318425160"],
  contactNames: ["Daryl Yang", "Daryl", "Leak Tester", "Cathy", "John", "Tim Wang", "Sam Sun", "李小姐 (A金瓯卡具)", "Lily"],
  usccs: ["91440300ZZLEAKTEST0"],
  cities: ["Dongguan", "Linyi", "Yiwu", "Qingdao", "Zhongshan", "Taizhou"],
};
const blocked = (text: string, extra: Partial<Parameters<typeof leakCheck>[0]> = {}) => leakCheck({ text, ...extra }, sources).ok === false;
const clean = (text: string, extra: Partial<Parameters<typeof leakCheck>[0]> = {}) => leakCheck({ text, ...extra }, sources).ok === true;

describe("leakCheck (SPEC B.5)", () => {
  it("passes clean client text and the exempt literals", () => {
    expect(leakCheck({ text: "QC passed on 22 Sep, 0 critical, 2 minor. Report attached." }, sources)).toEqual({ ok: true });
    expect(leakCheck({ text: "Factory F-0042 — the factory making your sleeves, shipped from China via Shenzhen" }, sources)).toEqual({ ok: true });
    expect(leakCheck({ text: "USD for now; EUR display is coming." }, sources)).toEqual({ ok: true });
    expect(leakCheck({ text: "Deposit and fee received, artwork approved — production starts" }, sources)).toEqual({ ok: true });
    expect(clean("Please verify the legal size and quote again"), "generic words from junk supplier names must not fire").toBe(true);
  });
  it("catches supplier legal name, stripped name, distinctive token and CN name", () => {
    expect(blocked("sample from zzleaktest co ltd")).toBe(true);
    expect(blocked("Yuantuo confirmed the mould")).toBe(true);
    expect(blocked("as YUANTUO confirmed")).toBe(true);
    expect(blocked("由东莞市源拓包装制品生产")).toBe(true);
    expect(blocked("Quoted by Yiwu Suti Crafts")).toBe(true);
    expect(stripCompanySuffix("Dongguan Yuantuo Packaging Products Co., Ltd.")).toBe("dongguan yuantuo packaging products");
    expect(stripCompanySuffix("东莞市源拓包装制品有限公司")).toBe("东莞市源拓包装制品");
  });
  it("catches handles, +86 numbers (any spacing), contact names, USCC", () => {
    expect(blocked("wechat me: zzleaktest_wx")).toBe(true);
    expect(blocked("call +86 138 0000 0042")).toBe(true);
    expect(blocked("call 13800000042 now")).toBe(true);
    expect(blocked("Daryl Yang will ship on Monday")).toBe(true);
    expect(blocked("registered 91440300ZZLEAKTEST0")).toBe(true);
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
    expect(blocked("https%3A%2F%2Fzzleaktest.en.alibaba.com")).toBe(true);
    expect(blocked("&#90;&#90;LEAKTEST Co., Ltd")).toBe(true);
    expect(() => assertClean({ text: "ZZLEAKTEST" }, sources)).toThrow(LeakCheckError);
  });
});

describe("leakCheck — QA-01 examples (all must be blocked)", () => {
  it("contact first name alone: 'Our factory contact Daryl will confirm the thickness tomorrow'", () => {
    const r = leakCheck({ text: "Our factory contact Daryl will confirm the thickness tomorrow" }, sources);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hits.some((h) => h.kind === "contact_name" && h.match.toLowerCase().includes("daryl"))).toBe(true);
  });
  it("CN short name: 'Update: 源拓 confirmed' and 源拓包装", () => {
    expect(blocked("Update: 源拓 confirmed")).toBe(true);
    expect(blocked("源拓包装 replied")).toBe(true);
    expect(cnShortNames("东莞市源拓包装制品有限公司")).toEqual(expect.arrayContaining(["源拓包装制品", "源拓包装", "源拓"]));
    expect(cnShortNames("临沂通福劳保用品有限公司")).toContain("通福");
    expect(cnShortNames("中山金瓯五金制品有限公司")).toContain("金瓯");
    expect(blocked("金瓯 will ship")).toBe(true);
  });
  it("CN personal names: 'Update: 李小姐 replied', 王先生, 张总, 陈经理, 老王, Mr Wang", () => {
    expect(blocked("Update: 李小姐 replied")).toBe(true);
    expect(blocked("王先生 says hi")).toBe(true);
    expect(blocked("张总 agreed")).toBe(true);
    expect(blocked("陈经理 checked it")).toBe(true);
    expect(blocked("老王 will call")).toBe(true);
    expect(blocked("Mr. Wang confirmed")).toBe(true);
    expect(blocked("Ms Li replied")).toBe(true);
  });
  it("cities with factory context: 'Update: Linyi factory ready', 'our factory in Dongguan'", () => {
    expect(blocked("Update: Linyi factory ready")).toBe(true);
    expect(blocked("Our factory in Dongguan finished the run")).toBe(true);
    expect(blocked("The supplier is based in Yiwu")).toBe(true);
    expect(blocked("东莞工厂已完成")).toBe(true);
  });
  it("English short name and split variants: Yuantuo, Yuan-tuo, Tongfu, Jinou, Sunshine Garden", () => {
    expect(blocked("Yuan-tuo confirmed")).toBe(true);
    expect(blocked("Tongfu can do it")).toBe(true);
    expect(blocked("Jinou quoted")).toBe(true);
    expect(blocked("Sunshine Garden replied")).toBe(true);
    expect(blocked("Dr. Card sent samples")).toBe(true);
    expect(enShortNames("Dongguan Yuantuo Packaging Products Co., Ltd.").tokens).toEqual(["yuantuo"]);
  });
  it("every contact-name token and handles", () => {
    expect(blocked("Tim will call")).toBe(true);
    expect(blocked("Wang will call")).toBe(true);
    expect(blocked("Cathy will ship on Monday"), "first names of supplier contacts now fire").toBe(true);
    expect(blocked("ping daryl_yt")).toBe(true);
    expect(blocked("xinhong1688 quoted")).toBe(true);
    expect(contactTokens("Sam Sun")).toEqual(["sam"]);
    expect(contactTokens("李小姐 (A金瓯卡具)")).toEqual(expect.arrayContaining(["李小姐", "金瓯卡具"]));
  });
  it("offer fields are factory context: inland city as port is blocked, loading port is fine", () => {
    expect(leakCheck({ fields: { Port: "Linyi" }, factoryContext: true }, sources).ok).toBe(false);
    expect(leakCheck({ fields: { Port: "Ningbo" }, factoryContext: true }, sources).ok).toBe(true);
    expect(leakCheck({ fields: { Port: "Shenzhen 深圳" }, factoryContext: true }, sources).ok).toBe(true);
  });
});

describe("leakCheck — false-positive guards", () => {
  it("names inside ordinary words never fire (word boundaries)", () => {
    expect(clean("We need more time to finish the samples")).toBe(true);         // Tim ⊂ time, Sam ⊂ samples
    expect(clean("Johnson & Johnson style box, delivered on Sunday")).toBe(true); // John ⊂ Johnson, Sun ⊂ Sunday
    expect(clean("The daily report is ready")).toBe(true);
    expect(clean("Leak-proof lid, tested twice")).toBe(true);                     // canary contact "Leak Tester"
    expect(clean("Standard card sleeves in stock")).toBe(true);                   // "Dr. Card" short name
    expect(clean("Christmas tree 180 cm, 507 tips")).toBe(true);                  // "Mali Tree"
    expect(clean("A stylish lamp for the garden")).toBe(true);                    // words of an all-generic supplier name, not adjacent
    expect(clean("Sunshine and garden products for spring")).toBe(true);          // phrase needs adjacency
  });
  it("port cities are fine outside a factory sentence; inland cities are fine without factory context", () => {
    expect(clean("FOB Shenzhen, ETA Gdańsk 18 Nov")).toBe(true);
    expect(clean("Shipped from Qingdao port on Monday")).toBe(true);
    expect(clean("The factory shipped the goods via Ningbo")).toBe(true);
    expect(clean("Weather in Dongguan delayed trucks")).toBe(true);
  });
  it("Chinese words that merely contain 总 / 姐 are not names", () => {
    expect(clean("总计 1000 件")).toBe(true);
    expect(clean("小姐姐")).toBe(true);
  });
});

describe("normaliseLoadingPort (QA-06)", () => {
  it("maps port spellings to the canonical port and rejects inland cities", () => {
    expect(normaliseLoadingPort("Shenzhen 深圳")).toBe("Shenzhen");
    expect(normaliseLoadingPort("FOB NINGBO")).toBe("Ningbo");
    expect(normaliseLoadingPort("Yantian")).toBe("Shenzhen");
    expect(normaliseLoadingPort("Linyi")).toBeNull();
    expect(normaliseLoadingPort("Dongyang")).toBeNull();
    expect(normaliseLoadingPort(null)).toBeNull();
  });
});
