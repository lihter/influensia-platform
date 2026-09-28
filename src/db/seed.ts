/**
 * SPEC §7 seed — `npm run db:seed`. Idempotent: PGlite dir, files dir and outbox.log are removed and rebuilt
 * (Postgres: every app/supplier/auth table is truncated first). Run with the dev server STOPPED in PGlite mode.
 *
 * Seed "today" = 2026-09-28 (SEED_CLOCK). Timestamps below are 09:00 UTC on the given day unless a time is given.
 * Users are created through `inviteUser()` (→ Better Auth sign-up + org hook) so password hashing and memberships are real.
 */
import { rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { sql, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

process.env.SEED_CLOCK ??= "2026-09-28T09:00:00Z";

import { getDb, PGLITE_DIR, type Db } from "./index";
import * as A from "./schema/app";
import * as S from "./schema/supplier";
import { LINE_STATES, type LineState, type Milestone, type ActivityType, type NotificationTemplate, type EntityType, type DocumentKind, type Visibility } from "./enums";
import type { PriceBreak } from "./types";
import { milestoneFor, isFeedState } from "@/server/shared/state-machine";
import { inviteUser } from "@/server/ops/admin";
import { logActivity } from "@/server/shared/activity";
import { enqueue, OUTBOX_LOG, localSender } from "@/server/shared/outbox";
import { storeDocument, storeUpload } from "@/server/shared/files";
import { setSequence, lineRef as mkLineRef, offerRef as mkOfferRef, sampleRef as mkSampleRef, orderRefFromRequest, poRef as mkPoRef } from "@/server/shared/ids";
import { now } from "@/server/shared/clock";
import { loadLineContexts } from "@/server/shared/line-context";
import { waitingItems } from "@/server/client/dashboard";
import { leakCheck, loadLeakSources } from "@/server/shared/leak-check";
import { stripCompanySuffix } from "@/server/shared/leak-check";

/* ───────────── helpers ───────────── */
const d = (day: string, time = "09:00") => new Date(`${day}T${time}:00Z`);
const e2 = (unit: number) => Math.round(unit * 10000);   // unit price → minor×100
const minor = (amount: number) => Math.round(amount * 100);
const id = () => uuidv7();
const PASSWORD = "Password123!";

type Ids = Record<string, string>;
const ids: Ids = {};
const summary: Record<string, number> = {};
const bump = (k: string, n = 1) => { summary[k] = (summary[k] ?? 0) + n; };

function resetLocal() {
  if (process.env.DATABASE_URL) return;
  const filesDir = process.env.FILES_DIR ?? path.join(process.cwd(), ".data", "files");
  for (const p of [PGLITE_DIR, filesDir, OUTBOX_LOG()]) if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

async function truncateAll(db: Db) {
  if (!process.env.DATABASE_URL) return;
  const tables = [
    ...Object.values(A).filter((t) => typeof t === "object" && t && "_" in (t as object)).map((t) => `app."${(t as { _: { name: string } })._.name}"`),
    ...Object.values(S).filter((t) => typeof t === "object" && t && "_" in (t as object)).map((t) => `supplier."${(t as { _: { name: string } })._.name}"`),
    '"user"', '"session"', '"account"', '"verification"', '"organization"', '"member"', '"invitation"',
  ];
  await db.execute(sql.raw(`TRUNCATE ${tables.join(", ")} CASCADE`));
}

/** Placeholder file bodies: one-page PDF with the filename as text; 800×600 JPG with the filename; tiny xlsx/png stubs. */
function pdfBytes(text: string): Buffer {
  const esc = text.replace(/[()\\]/g, (c) => `\\${c}`);
  const content = `BT /F1 24 Tf 60 500 Td (${esc}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
async function imageBytes(text: string, ext: "jpg" | "png"): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#F3F1EA"/><rect x="40" y="40" width="720" height="520" fill="#FFFFFF" stroke="#E0D9CA"/><text x="400" y="290" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#171717">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text><text x="400" y="330" font-family="monospace" font-size="16" text-anchor="middle" fill="#5F6670">placeholder · influensia seed</text></svg>`;
  const s = sharp(Buffer.from(svg));
  return ext === "jpg" ? s.jpeg({ quality: 80 }).toBuffer() : s.png().toBuffer();
}
async function fileBody(filename: string): Promise<{ data: Buffer; mime: string }> {
  const ext = filename.split(".").pop()!.toLowerCase();
  if (ext === "pdf") return { data: pdfBytes(filename), mime: "application/pdf" };
  if (ext === "jpg" || ext === "jpeg") return { data: await imageBytes(filename, "jpg"), mime: "image/jpeg" };
  if (ext === "png") return { data: await imageBytes(filename, "png"), mime: "image/png" };
  if (ext === "xlsx") return { data: Buffer.from(`placeholder xlsx: ${filename}\n`), mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  return { data: Buffer.from(`placeholder: ${filename}\n`), mime: "application/octet-stream" };
}

/* ───────────── main ───────────── */
export async function seed() {
  const t0 = Date.now();
  resetLocal();
  const db = await getDb();
  await truncateAll(db);
  const AT = now();

  /* 7.1 organisations */
  const orgs = {
    AGENCY: { id: id(), type: "agency" as const, name: "Influensia", country: "RO", timezone: "Europe/Zagreb" },
    KOFF: { id: id(), type: "client" as const, name: "KOFF", country: "PL", timezone: "Europe/Warsaw" },
    PIOTR: { id: id(), type: "client" as const, name: "Piotr's team", country: "PL", timezone: "Europe/Warsaw" },
  };
  for (const o of Object.values(orgs)) {
    await db.insert(A.organizations).values({ id: o.id, type: o.type, name: o.name, country: o.country, timezone: o.timezone, commercialMode: "agency_passthrough", pricingDisplay: "factory_plus_fee", defaultIncoterm: "FOB", depositPct: 30, createdAt: d("2026-05-01"), updatedAt: d("2026-05-01") });
    bump("organizations");
  }
  const { AGENCY, KOFF, PIOTR } = orgs;

  /* 7.2 users (via inviteUser → Better Auth sign-up + org hook) */
  const users = [
    { key: "marko", email: "marko@influensia.ro", name: "Marko", role: "admin" as const, orgId: AGENCY.id },
    { key: "bogdan", email: "bogdan@influensia.ro", name: "Bogdan", role: "agent" as const, orgId: AGENCY.id },
    { key: "cristina", email: "cristina@influensia.ro", name: "Cristina", role: "agent" as const, orgId: AGENCY.id },
    { key: "piotr", email: "piotr@example.pl", name: "Piotr", role: "client_owner" as const, orgId: PIOTR.id },
    { key: "anna", email: "buyer@koff.example", name: "Anna (KOFF)", role: "client_owner" as const, orgId: KOFF.id },
  ];
  for (const u of users) {
    const r = await inviteUser(null, { email: u.email, name: u.name, role: u.role, orgId: u.orgId, password: PASSWORD, at: d("2026-05-02") });
    ids[u.key] = r.userId;
    await db.update(A.users).set({ passwordSetAt: d("2026-05-02"), lastSeenAt: AT }).where(eq(A.users.id, r.userId));
    bump("users");
  }
  const U = (k: string) => ids[k];
  const NAME: Record<string, string> = Object.fromEntries(users.map((u) => [ids[u.key], u.name]));

  /* 7.3 pricing rules + fx */
  const rules: [string, number, number, number, number][] = [["packaging", 20, 15, 10, 4], ["fitness", 20, 18, 10, 2], ["garden", 20, 15, 8, 2], ["lighting", 20, 18, 10, 2], ["safety", 20, 20, 10, 3], ["seasonal", 20, 15, 8, 2], ["default", 20, 15, 10, 2]];
  for (const [category, upliftPct, marginPct, feePct, rounding] of rules) { await db.insert(A.pricingRules).values({ id: id(), category, upliftPct, marginPct, feePct, rounding, createdBy: U("marko") }); bump("pricing_rules"); }
  for (const [date, base, quote, rate, source] of [["2026-09-21", "USD", "CNY", 6.6933, "tradingeconomics"], ["2026-06-15", "USD", "CNY", 7.18, "tradingeconomics"], ["2026-09-21", "USD", "EUR", 0.92, "tradingeconomics"]] as const) {
    await db.insert(A.fxRates).values({ id: id(), date, base, quote, rate, source }); bump("fx_rates");
  }

  /* 7.4 suppliers */
  type Sup = { ref: string; legalName: string; cnName?: string; verdict: "manufacturer" | "trading" | "unchecked"; source: "baidu" | "alibaba_profile" | "sheet_import" | "other"; grade?: "A" | "B" | "C" | "D" | "E"; city?: string; registered?: string; capital?: string; ports: string[]; notes?: string; uscc?: string; contacts: { name?: string; channel: "alibaba" | "1688" | "wechat" | "email"; handle?: string; phone?: string }[]; disclosedTo?: string[] };
  const sups: Sup[] = [
    { ref: "SUP-0001", legalName: "Qingdao Ecosino Industry Co., Ltd.", cnName: "青岛亿科盛诺实业有限公司", verdict: "manufacturer", source: "baidu", grade: "B", city: "Qingdao", registered: "2012-01-01", capital: "5 M CNY", ports: ["Qingdao"], notes: "Payment 50/50 or 30/70 +$0.1/set.", contacts: [{ name: "Benson Zhao", channel: "alibaba", handle: "ecosino-benson" }], disclosedTo: [KOFF.id] },
    { ref: "SUP-0002", legalName: "Qingdao Xinyi Metal Products Co., Ltd.", verdict: "manufacturer", source: "baidu", grade: "C", city: "Qingdao", ports: ["Qingdao"], contacts: [{ name: "David Yang", channel: "alibaba" }] },
    { ref: "SUP-0003", legalName: "Linyi Tongfu Safety Products Co., Ltd.", cnName: "临沂通福劳保用品有限公司", verdict: "manufacturer", source: "baidu", grade: "B", city: "Linyi", registered: "2015-01-01", capital: "2 M CNY", ports: ["Qingdao", "Ningbo"], contacts: [{ name: "Tongfu Wang", channel: "alibaba", handle: "tongfu-wang" }] },
    { ref: "SUP-0004", legalName: "Nantong Stylish Lighting Co., Ltd.", verdict: "manufacturer", source: "alibaba_profile", grade: "B", city: "Nantong", ports: ["Shanghai", "Ningbo"], contacts: [{ name: "Sarah Ji", channel: "alibaba", handle: "sarah-ji" }] },
    { ref: "SUP-0005", legalName: "Yiwu Mali Tree Co., Ltd.", cnName: "义乌马里圣诞树有限公司", verdict: "manufacturer", source: "baidu", grade: "C", city: "Yiwu", ports: ["Ningbo"], notes: "962 tips version", contacts: [{ name: "Sam Sun", channel: "alibaba", handle: "sam-sun" }] },
    { ref: "SUP-0006", legalName: "Dongyang Xinhong Crafts Factory", cnName: "东阳鑫宏工艺品厂", verdict: "unchecked", source: "sheet_import", city: "Dongyang", ports: ["Ningbo"], notes: "Chinese-only", contacts: [{ channel: "1688", handle: "xinhong1688" }] },
    { ref: "SUP-0007", legalName: "Dongguan Yuantuo Packaging Products Co., Ltd.", cnName: "东莞市源拓包装制品有限公司", verdict: "manufacturer", source: "baidu", grade: "B", city: "Dongguan", registered: "2011-01-01", capital: "3 M CNY", ports: ["Shenzhen"], notes: "Declares g/100 weights 58/51/100", contacts: [{ name: "Daryl Yang", channel: "email", handle: "daryl@yuantuo.example" }, { name: "Daryl", channel: "wechat", handle: "daryl_yt" }] },
    { ref: "SUP-0008", legalName: "Yiwu Suti Crafts Co., Ltd.", cnName: "义乌市苏媞工艺品有限公司", verdict: "trading", source: "baidu", grade: "D", city: "Yiwu", registered: "2026-03-01", capital: "100 k CNY", ports: ["Ningbo"], notes: "6-month-old trader; double-wall micron suspicion", contacts: [{ name: "Tim Wang", channel: "alibaba", handle: "tim-suti" }] },
    { ref: "SUP-0009", legalName: "Yili (依立) — verify legal name", cnName: "依立", verdict: "unchecked", source: "sheet_import", ports: [], notes: "Quote B; quotes per bag of 100", contacts: [{ channel: "1688", handle: "yili1688" }] },
    { ref: "SUP-0010", legalName: "Guangdong Dr. Card Culture Co., Ltd.", cnName: "广东卡博士文化有限公司", verdict: "manufacturer", source: "baidu", grade: "C", city: "Guangzhou", ports: ["Shenzhen", "Guangzhou"], notes: "Same group as Guangdong Kepu", contacts: [{ name: "Cathy", channel: "wechat", handle: "drcard_cathy" }] },
    { ref: "SUP-0011", legalName: "Unidentified — Quote D (verify)", verdict: "unchecked", source: "other", ports: [], notes: "Anonymous xlsx, MOQ 100 000, 10/10 SKUs", contacts: [{ channel: "email", handle: "quoted@anon.example" }] },
    { ref: "SUP-0012", legalName: "Huizhou Boyuan Plastic Products", cnName: "惠州博源塑胶制品", verdict: "manufacturer", source: "baidu", city: "Huizhou", ports: ["Shenzhen"], contacts: [{ name: "John", channel: "wechat", handle: "boyuan_john" }, { name: "John", channel: "1688", handle: "boyuan1688" }] },
    { ref: "SUP-0013", legalName: "Wenzhou Fuli Packaging Co., Ltd.", cnName: "温州富利包装有限公司", verdict: "manufacturer", source: "baidu", city: "Wenzhou", ports: ["Ningbo"], contacts: [{ name: "Yulia Yang", channel: "alibaba", handle: "yulia-fuli" }] },
    { ref: "SUP-0014", legalName: "Zhongshan Jinou Hardware Products Co., Ltd.", cnName: "中山金瓯五金制品有限公司", verdict: "manufacturer", source: "baidu", city: "Zhongshan", ports: ["Shenzhen"], notes: "Metal only", contacts: [{ name: "李小姐 (A金瓯卡具)", channel: "wechat", phone: "13318425160" }, { channel: "1688", handle: "jinou1688" }] },
    { ref: "SUP-0015", legalName: "Shandong Zhongjian Steel Structure Co., Ltd.", verdict: "manufacturer", source: "baidu", city: "Jinan", ports: ["Qingdao"], contacts: [{ name: "Lily", channel: "alibaba", handle: "zhongjian-lily" }] },
    { ref: "SUP-0016", legalName: "Taizhou Sunshine Garden Products Co., Ltd.", verdict: "unchecked", source: "sheet_import", city: "Taizhou", ports: ["Ningbo"], notes: "resin sheds", contacts: [{ name: "Vicky Zhong", channel: "alibaba", handle: "vicky-zhong" }] },
    { ref: "SUP-0017", legalName: "ZZLEAKTEST Co., Ltd.", cnName: "ZZ泄漏测试有限公司", verdict: "manufacturer", source: "other", grade: "C", city: "Dongguan", registered: "2020-01-01", capital: "1 M CNY", ports: ["Shenzhen"], uscc: "91440300ZZLEAKTEST0", notes: "ZZLEAKTEST canary — never publish", contacts: [{ name: "Leak Tester", channel: "wechat", handle: "zzleaktest_wx", phone: "+86 138 0000 0042" }, { name: "Leak Tester", channel: "alibaba", handle: "https://zzleaktest.en.alibaba.com" }] },
  ];
  const contactIds: Record<string, string> = {};
  for (const s of sups) {
    const sid = id(); ids[s.ref] = sid;
    await db.insert(S.suppliers).values({ id: sid, ref: s.ref, legalName: s.legalName, normalisedName: stripCompanySuffix(s.legalName), cnName: s.cnName ?? null, typeVerdict: s.verdict, verdictSource: s.source, verdictCheckedAt: d("2026-08-29"), grade: s.grade ?? null, uscc: s.uscc ?? null, registeredAt: s.registered ?? null, capital: s.capital ?? null, city: s.city ?? null, ports: s.ports, notes: s.notes ?? null, disclosedToOrgIds: s.disclosedTo ?? [], createdBy: U("bogdan"), createdAt: d("2026-06-01"), updatedAt: d("2026-06-01") });
    bump("suppliers");
    for (const [i, c] of s.contacts.entries()) {
      const cid = id(); contactIds[`${s.ref}:${i}`] = cid;
      await db.insert(S.supplierContacts).values({ id: cid, supplierId: sid, name: c.name ?? null, channel: c.channel, handle: c.handle ?? null, phone: c.phone ?? null, isPrimary: i === 0 });
      bump("supplier_contacts");
    }
    await db.insert(S.supplierPerformance).values({ supplierId: sid, ordersCount: 0 });
  }
  const SUP = (ref: string) => ids[ref];

  /* 7.5 products + specs + images */
  type Prod = { ref: string; name: string; category: string; unit: string; catalog?: { price: number; moq: number; incoterm: string; port: string; specV: number; valid: string }; owner: string; specs: { v: number; at: string; fields: Record<string, string | number | boolean> }[] };
  const prods: Prod[] = [
    { ref: "PRD-0001", name: "Boltless steel shelving 5-tier 180×90×40 black", category: "garden", unit: "set", owner: KOFF.id, catalog: { price: 8.9, moq: 1000, incoterm: "FOB", port: "Qingdao", specV: 2, valid: "2026-12-31" }, specs: [{ v: 1, at: "2026-06-05", fields: { size: "180×90×40 cm", shelves: "5 MDF", load_per_shelf: "175 kg", finish: "powder-coated black" } }, { v: 2, at: "2026-06-10", fields: { size: "180×90×40 cm", shelves: "5 MDF", load_per_shelf: "175 kg", load_total: "875 kg", finish: "powder-coated black", carton: "2/set" } }] },
    { ref: "PRD-0002", name: "Work gloves red latex crinkle, size 10", category: "safety", unit: "pair", owner: KOFF.id, catalog: { price: 0.26, moq: 10000, incoterm: "FOB", port: "Ningbo", specV: 1, valid: "2026-12-31" }, specs: [{ v: 1, at: "2026-09-12", fields: { liner: "13 g polyester", palm: "red crinkle latex", size: "10", standard: "EN 388 2121X" } }] },
    { ref: "PRD-0003", name: "Icicle lights 500 LED 24 m", category: "lighting", unit: "set", owner: KOFF.id, catalog: { price: 9.9, moq: 1000, incoterm: "FOB", port: "Ningbo", specV: 1, valid: "2026-12-31" }, specs: [{ v: 1, at: "2026-09-13", fields: { leds: "500 warm white", length: "24 m", ip: "IP44", plug: "EU", modes: 8 } }] },
    { ref: "PRD-0004", name: "Card sleeves 66×91 mm 100 µm", category: "packaging", unit: "pcs", owner: PIOTR.id, catalog: { price: 0.062, moq: 100000, incoterm: "FOB", port: "Shenzhen", specV: 1, valid: "2026-12-31" }, specs: [{ v: 1, at: "2026-09-03", fields: { size: "66×91 mm", thickness: "100 µm single wall", material: "PP virgin", pack: "100/bag", pvc_free: true } }] },
    { ref: "PRD-0005", name: "Standard sleeves 66×91 mm 80 µm", category: "packaging", unit: "pcs", owner: PIOTR.id, specs: [{ v: 1, at: "2026-09-03", fields: { size: "66×91 mm", thickness: "80 µm single wall", material: "PP virgin", pack: "100/bag", pvc_free: true } }] },
    { ref: "PRD-0006", name: "Japanese size sleeves 62×89 mm 100 µm", category: "packaging", unit: "pcs", owner: PIOTR.id, specs: [{ v: 1, at: "2026-09-03", fields: { size: "62×89 mm", thickness: "100 µm", material: "PP virgin" } }] },
    { ref: "PRD-0007", name: "Team bag 66×91 mm", category: "packaging", unit: "pcs", owner: PIOTR.id, specs: [{ v: 1, at: "2026-09-03", fields: { size: "66×91 mm", thickness: "50 µm", finish: "clear", closure: "resealable" } }] },
    { ref: "PRD-0008", name: "Toploader 35pt 76.2×103.2 mm", category: "packaging", unit: "pcs", owner: PIOTR.id, specs: [{ v: 1, at: "2026-09-03", fields: { size: "76.2×103.2 mm", panel: "≥ 0.305 mm", material: "PET, PVC-free" } }] },
    { ref: "PRD-0009", name: "Toploader 130pt", category: "packaging", unit: "pcs", owner: PIOTR.id, specs: [{ v: 1, at: "2026-09-03", fields: { material: "PET", thickness: "130pt", size: "76.2×103.2 mm" } }] },
    { ref: "PRD-0010", name: "Magnetic one-touch holder 35pt", category: "packaging", unit: "pcs", owner: PIOTR.id, specs: [{ v: 1, at: "2026-09-03", fields: { pull: "≥ 1.5 kg", uv: "UV-protected", thickness: "35pt" } }] },
    { ref: "PRD-0011", name: "Album/binder 9-pocket, 360 pockets", category: "packaging", unit: "pcs", owner: PIOTR.id, specs: [{ v: 1, at: "2026-09-17", fields: { pages: "20 PP side-load", pockets: 360, closure: "zip" } }] },
    { ref: "PRD-0012", name: "Metal apex garden shed 201×181×190", category: "garden", unit: "set", owner: KOFF.id, specs: [{ v: 1, at: "2026-09-19", fields: { size: "201×181×190 cm", steel: "galvanised 0.25 mm", roof: "apex" } }] },
    { ref: "PRD-0013", name: "Resin garden shed 130×192×198", category: "garden", unit: "set", owner: KOFF.id, specs: [{ v: 1, at: "2026-09-19", fields: { size: "130×192×198 cm", material: "PP resin", style: "Keter-type" } }] },
    { ref: "PRD-0014", name: "Large metal store 460×312×194", category: "garden", unit: "set", owner: KOFF.id, specs: [{ v: 1, at: "2026-09-19", fields: { size: "460×312×194 cm", steel: "galvanised", door: "double" } }] },
    { ref: "PRD-0015", name: "Christmas tree 180 cm 507 tips PVC", category: "seasonal", unit: "pcs", owner: KOFF.id, specs: [{ v: 1, at: "2026-09-15", fields: { height: "180 cm", tips: 507, material: "PVC", stand: "metal" } }] },
  ];
  for (const p of prods) {
    const pid = id(); ids[p.ref] = pid;
    await db.insert(A.products).values({ id: pid, ref: p.ref, ownerOrgId: p.owner, name: p.name, category: p.category, unit: p.unit, visibility: p.catalog ? "catalog" : "private", referencePriceMinorE2: p.catalog ? e2(p.catalog.price) : null, referenceCurrency: "USD", referenceMoq: p.catalog?.moq ?? null, referenceIncoterm: p.catalog?.incoterm ?? null, referencePort: p.catalog?.port ?? null, referenceSpecVersion: p.catalog?.specV ?? null, referenceValidUntil: p.catalog?.valid ?? null, publishedAt: p.catalog ? d("2026-09-21") : null, createdBy: U("bogdan"), createdAt: d(p.specs[0].at), updatedAt: d(p.specs[0].at) });
    bump("products");
    for (const s of p.specs) { await db.insert(A.productSpecs).values({ id: id(), productId: pid, version: s.v, fields: s.fields, frozenAt: d(s.at), frozenBy: U("bogdan"), createdAt: d(s.at) }); bump("product_specs"); }
    if (p.catalog) {
      for (const kind of ["clean", "supplier_facing"] as const) {
        const body = await imageBytes(`${p.ref} ${kind}`, "jpg");
        const f = await storeUpload(db, { orgId: kind === "clean" ? AGENCY.id : p.owner, userId: U("bogdan"), data: body, mime: "image/jpeg", originalName: `${p.ref}-${kind}.jpg`, entity: "product", entityId: pid, visibility: kind === "clean" ? "client" : "internal", at: d("2026-09-21") });
        await db.insert(A.productImages).values({ id: id(), productId: pid, fileId: f.id, kind, approvedBy: kind === "clean" ? U("marko") : null, createdAt: d("2026-09-21") });
        bump("product_images");
      }
    }
  }
  const PRD = (ref: string) => ids[ref];

  /* 7.6 requests + lines */
  type Req = { ref: string; org: string; source: "portal" | "import" | "agent_on_behalf"; clientRef?: string; submitted?: string; note?: string; createdBy: string; status: "draft" | "submitted" | "active" | "closed" };
  const reqs: Req[] = [
    { ref: "REQ-2026-0290", org: KOFF.id, source: "import", clientRef: "SHELVING-0290", submitted: "2026-06-01", note: "5-tier boltless, black, MDF shelves", createdBy: U("anna"), status: "active" },
    { ref: "REQ-2026-0301", org: KOFF.id, source: "portal", submitted: "2026-09-10", note: "Red latex gloves like the Allegro link, size 10", createdBy: U("anna"), status: "active" },
    { ref: "REQ-2026-0305", org: KOFF.id, source: "portal", submitted: "2026-09-12", createdBy: U("anna"), status: "active" },
    { ref: "REQ-2026-0312", org: PIOTR.id, source: "import", clientRef: "ORDER-2026-#312", submitted: "2026-09-01", note: "Photos are form reference, not branding. FOB USD per single piece.", createdBy: U("piotr"), status: "active" },
    { ref: "REQ-2026-0318", org: KOFF.id, source: "agent_on_behalf", submitted: "2026-09-14", createdBy: U("cristina"), status: "active" },
    { ref: "REQ-2026-0321", org: KOFF.id, source: "import", clientRef: "SHEDS-3210", submitted: "2026-09-18", note: "3 models, see Allegro links", createdBy: U("anna"), status: "active" },
    { ref: "REQ-2026-0322", org: KOFF.id, source: "portal", createdBy: U("anna"), status: "draft" },
    { ref: "REQ-2026-0325", org: KOFF.id, source: "portal", submitted: "2026-09-27", note: "Bogdan: ASAP, at least a top 10 of this type", createdBy: U("anna"), status: "submitted" },
  ];
  for (const r of reqs) {
    const rid = id(); ids[r.ref] = rid;
    const created = r.submitted ? d(r.submitted) : d("2026-09-26");
    await db.insert(A.requests).values({ id: rid, ref: r.ref, orgId: r.org, source: r.source, status: r.status, clientRef: r.clientRef ?? null, note: r.note ?? null, submittedAt: r.submitted ? d(r.submitted) : null, createdBy: r.createdBy, createdAt: created, updatedAt: created });
    bump("requests");
  }
  const REQ = (ref: string) => ids[ref];

  type Line = { ref: string; req: string; no: number; prd?: string; name: string; qty: number; unit: string; state: LineState; last: string; agent?: string; sku?: string; links?: string[]; specV?: number; cost?: { est: number; target: number; material?: number; process?: number; packaging?: number; overhead?: number; confirmedAt?: string }; artwork?: boolean; sample?: boolean; created?: string; note?: string };
  const lines: Line[] = [
    { ref: "REQ-2026-0290-01", req: "REQ-2026-0290", no: 1, prd: "PRD-0001", name: "Boltless steel shelving 5-tier 180×90×40 black", qty: 1000, unit: "set", state: "delivered", last: "2026-08-28", agent: "bogdan", links: ["https://allegro.pl/oferta/regal-metalowy-180x90x40"], specV: 2, artwork: false, sample: false, created: "2026-06-01" },
    { ref: "REQ-2026-0301-01", req: "REQ-2026-0301", no: 1, prd: "PRD-0002", name: "Work gloves red latex crinkle, size 10", qty: 10000, unit: "pair", state: "offer_ready", last: "2026-09-26", agent: "bogdan", links: ["https://allegro.pl/oferta/rekawiczki-rekawice-robocze-r10-latex-10-par-wytrzymale-porowate-red-lateks-12539547048"], specV: 1, cost: { est: 0.17, target: 0.204, confirmedAt: "2026-09-12" }, artwork: true, sample: false, created: "2026-09-10" },
    { ref: "REQ-2026-0305-01", req: "REQ-2026-0305", no: 1, prd: "PRD-0003", name: "Icicle lights 500 LED 24 m", qty: 1000, unit: "set", state: "negotiating", last: "2026-09-24", agent: "bogdan", links: ["https://allegro.pl/oferta/sople-500-led-24m"], specV: 1, cost: { est: 7.1, target: 8.52, confirmedAt: "2026-09-13" }, created: "2026-09-12" },
    { ref: "REQ-2026-0312-01", req: "REQ-2026-0312", no: 1, prd: "PRD-0004", name: "Standard sleeves 66×91 mm, 100 µm, PP, 100/bag", qty: 100000, unit: "pcs", state: "in_production", last: "2026-09-23", agent: "bogdan", sku: "KOFF-312-01", specV: 1, cost: { est: 0.031, target: 0.037, material: 0.004, process: 0.02, packaging: 0.004, overhead: 10, confirmedAt: "2026-09-04" }, artwork: true, sample: true, created: "2026-09-01" },
    { ref: "REQ-2026-0312-02", req: "REQ-2026-0312", no: 2, prd: "PRD-0005", name: "Standard sleeves 66×91 mm, 80 µm", qty: 100000, unit: "pcs", state: "sampling", last: "2026-09-19", agent: "bogdan", sku: "KOFF-312-02", specV: 1, cost: { est: 0.027, target: 0.032, confirmedAt: "2026-09-04" }, sample: true, created: "2026-09-01" },
    { ref: "REQ-2026-0312-03", req: "REQ-2026-0312", no: 3, prd: "PRD-0006", name: "Japanese size 62×89 mm, 100 µm", qty: 50000, unit: "pcs", state: "negotiating", last: "2026-09-22", agent: "bogdan", sku: "KOFF-312-03", specV: 1, cost: { est: 0.03, target: 0.036, confirmedAt: "2026-09-04" }, created: "2026-09-01" },
    { ref: "REQ-2026-0312-05", req: "REQ-2026-0312", no: 5, prd: "PRD-0007", name: "Team bag 66×91", qty: 50000, unit: "pcs", state: "quotes_in", last: "2026-09-23", agent: "bogdan", sku: "KOFF-312-05", specV: 1, cost: { est: 0.0075, target: 0.009, confirmedAt: "2026-09-04" }, created: "2026-09-01" },
    { ref: "REQ-2026-0312-11", req: "REQ-2026-0312", no: 11, prd: "PRD-0008", name: "Toploader 35pt 76.2×103.2 mm, PVC-free", qty: 20000, unit: "pcs", state: "quotes_in", last: "2026-09-24", agent: "bogdan", sku: "KOFF-312-11", specV: 1, cost: { est: 0.108, target: 0.13, confirmedAt: "2026-09-04" }, created: "2026-09-01" },
    { ref: "REQ-2026-0312-14", req: "REQ-2026-0312", no: 14, prd: "PRD-0009", name: "Toploader 130pt", qty: 5000, unit: "pcs", state: "rfq_out", last: "2026-09-12", agent: "bogdan", sku: "KOFF-312-14", specV: 1, cost: { est: 0.25, target: 0.3, confirmedAt: "2026-09-04" }, created: "2026-09-01" },
    { ref: "REQ-2026-0312-20", req: "REQ-2026-0312", no: 20, prd: "PRD-0010", name: "Magnetic one-touch holder 35pt (pull ≥ 1.5 kg)", qty: 5000, unit: "pcs", state: "quotes_in", last: "2026-09-23", agent: "bogdan", sku: "KOFF-312-20", specV: 1, cost: { est: 1.58, target: 1.9, confirmedAt: "2026-09-04" }, created: "2026-09-01" },
    { ref: "REQ-2026-0312-26", req: "REQ-2026-0312", no: 26, prd: "PRD-0011", name: "Album/binder 9-pocket, 360 pockets, PP pages", qty: 2000, unit: "pcs", state: "spec_frozen", last: "2026-09-17", agent: "bogdan", sku: "KOFF-312-26", specV: 1, created: "2026-09-01" },
    { ref: "REQ-2026-0318-01", req: "REQ-2026-0318", no: 1, prd: "PRD-0015", name: "Christmas tree 180 cm 507 tips PVC", qty: 2000, unit: "pcs", state: "quotes_in", last: "2026-09-16", agent: "cristina", links: ["https://allegro.pl/oferta/choinka-sztuczna-180cm-springos"], specV: 1, created: "2026-09-14" },
    { ref: "REQ-2026-0321-01", req: "REQ-2026-0321", no: 1, prd: "PRD-0012", name: "Metal apex shed 201×181×190", qty: 200, unit: "set", state: "quotes_in", last: "2026-09-25", agent: "marko", sku: "SHEDS-3210-01", links: ["https://allegro.pl/oferta/domek-ogrodowy-narzedziowy-metalowy-na-narzedzia-vector-7x6-201x190cm-garaz-18438914106"], specV: 1, created: "2026-09-18" },
    { ref: "REQ-2026-0321-02", req: "REQ-2026-0321", no: 2, prd: "PRD-0013", name: "Resin shed 130×192×198", qty: 200, unit: "set", state: "quotes_in", last: "2026-09-25", agent: "marko", sku: "SHEDS-3210-02", links: ["https://allegro.pl/oferta/domek-ogrodowy-narzedziowy-keter-manor-4x6s-schowek-na-narzedzia-192x130cm-12826867592"], specV: 1, created: "2026-09-18" },
    { ref: "REQ-2026-0321-03", req: "REQ-2026-0321", no: 3, prd: "PRD-0014", name: "Large metal store 460×312×194", qty: 50, unit: "set", state: "quotes_in", last: "2026-09-25", agent: "marko", sku: "SHEDS-3210-03", links: ["https://allegro.pl/oferta/domek-narzedziowy-metalowy-garderis-312-460-194-cm-13-2-m2-18789627689"], specV: 1, created: "2026-09-18" },
    { ref: "REQ-2026-0322-01", req: "REQ-2026-0322", no: 1, name: "ULFUR ultralight camping chair 4-leg hub", qty: 500, unit: "pcs", state: "draft", last: "2026-09-26", links: ["https://allegro.pl/oferta/krzeslo-turystyczne-ulfur-ultralight", "https://www.alibaba.com/product-detail/ultralight-camping-chair_1601234567890.html"], created: "2026-09-26" },
    { ref: "REQ-2026-0325-01", req: "REQ-2026-0325", no: 1, name: "LED floodlight on tripod SmartLED 150 W 16500 lm IP65", qty: 300, unit: "pcs", state: "submitted", last: "2026-09-27", links: ["https://allegro.pl/produkt/lampa-na-stojaku-smartled-150w-16500-lm-ip65-bialy-neutralny-214f71dc-85af-4abb-a679-953740ee42fc"], created: "2026-09-27" },
  ];
  const lineOrg: Record<string, string> = {};
  for (const l of lines) {
    const lid = id(); ids[l.ref] = lid;
    const org = reqs.find((r) => r.ref === l.req)!.org; lineOrg[l.ref] = org;
    const created = d(l.created ?? l.last);
    await db.insert(A.requestLines).values({
      id: lid, requestId: REQ(l.req), orgId: org, lineNo: l.no, lineRef: l.ref, productId: l.prd ? PRD(l.prd) : null, name: l.name, qtyFirst: l.qty, unit: l.unit, clientSku: l.sku ?? null,
      clientLinks: l.links ?? [], linksMeta: (l.links ?? []).map((url) => ({ url, domain: new URL(url).hostname, not_durable: /alibaba\.com/.test(url) })),
      state: l.state, milestone: milestoneFor(l.state), specVersion: l.specV ?? null, assignedAgentId: l.agent ? U(l.agent) : null,
      costModel: l.cost ? { est_prod_cost_minor_e2: e2(l.cost.est), material_floor_minor_e2: l.cost.material ? e2(l.cost.material) : undefined, process_cost_minor_e2: l.cost.process ? e2(l.cost.process) : undefined, packaging_minor_e2: l.cost.packaging ? e2(l.cost.packaging) : undefined, overhead_pct: l.cost.overhead, method: "mass × resin price" } : null,
      upliftPct: l.cost ? 20 : null, targetPriceMinorE2: l.cost ? e2(l.cost.target) : null, targetConfirmedBy: l.cost ? U(l.agent ?? "bogdan") : null, targetConfirmedAt: l.cost?.confirmedAt ? d(l.cost.confirmedAt) : null,
      artworkRequired: l.artwork ?? false, sampleRequired: l.sample ?? true, lastStateChangeAt: d(l.last), createdBy: l.agent === "cristina" ? U("cristina") : org === KOFF.id ? U("anna") : U("piotr"), createdAt: created, updatedAt: d(l.last),
    });
    bump("request_lines");
  }
  const LINE = (ref: string) => ids[ref];

  /* 7.7 participations + quotes (+ rfq) */
  type Q = { at: string; currency?: string; unit?: string; pack?: number; incoterm: string | null; uncertain?: boolean; port?: string; breaks: [number, number][]; moq?: number; lead?: number; leadMax?: number; valid: string; terms?: string; dev?: string; weight?: number; file?: string; flags?: string[] };
  type Part = { line: string; sup: string; status: "contacted" | "quoted" | "shortlisted" | "negotiating" | "selected" | "backup" | "dropped" | "cannot_make"; reason?: string; first: string; last: string; quotes?: Q[]; contact?: number };
  const parts: Part[] = [
    { line: "REQ-2026-0290-01", sup: "SUP-0001", status: "selected", first: "2026-06-03", last: "2026-06-14", quotes: [{ at: "2026-06-09", incoterm: "FOB", port: "Qingdao", breaks: [[500, 7.9], [1000, 7.52]], moq: 500, lead: 35, valid: "2026-10-31", terms: "50/50 or 30/70 +$0.1/set" }] },
    { line: "REQ-2026-0290-01", sup: "SUP-0002", status: "dropped", reason: "no MDF shelf option", first: "2026-06-03", last: "2026-06-09", quotes: [{ at: "2026-06-08", incoterm: "FOB", port: "Qingdao", breaks: [[1000, 7.9]], moq: 1000, lead: 30, valid: "2026-07-31" }] },
    { line: "REQ-2026-0290-01", sup: "SUP-0017", status: "dropped", reason: "canary", first: "2026-06-03", last: "2026-06-04" },
    { line: "REQ-2026-0301-01", sup: "SUP-0003", status: "selected", first: "2026-09-13", last: "2026-09-25", quotes: [{ at: "2026-09-20", incoterm: "EXW", port: "Linyi", breaks: [[10000, 0.205]], moq: 10000, lead: 25, valid: "2026-10-31", terms: "30/70 T/T" }] },
    { line: "REQ-2026-0305-01", sup: "SUP-0004", status: "negotiating", first: "2026-09-14", last: "2026-09-24", quotes: [{ at: "2026-09-17", incoterm: "FOB", port: "Ningbo", breaks: [[500, 9.33], [1000, 8.9], [3000, 8.7]], moq: 500, lead: 30, valid: "2026-10-15" }, { at: "2026-09-24", incoterm: "FOB", port: "Ningbo", breaks: [[1000, 8.4]], moq: 500, lead: 30, valid: "2026-10-15" }] },
    { line: "REQ-2026-0312-01", sup: "SUP-0007", status: "selected", first: "2026-09-05", last: "2026-09-26", quotes: [{ at: "2026-09-15", incoterm: "FOB", port: "Shenzhen", breaks: [[100000, 0.0539]], moq: 100000, lead: 30, valid: "2026-09-30", terms: "T/T 30/70", dev: "none at spec thickness", weight: 0.58, file: "Yuantuo-quote-2026-09-15.xlsx" }] },
    { line: "REQ-2026-0312-01", sup: "SUP-0008", status: "dropped", reason: "6-month-old trader; double-wall micron suspicion", first: "2026-09-05", last: "2026-09-05", quotes: [{ at: "2026-09-06", unit: "bag", pack: 100, incoterm: "FOB", port: "Ningbo", breaks: [[3000, 3.2]], moq: 3000, lead: 8, leadMax: 10, valid: "2026-09-08", terms: "50 % deposit" }] },
    { line: "REQ-2026-0312-01", sup: "SUP-0009", status: "quoted", first: "2026-09-06", last: "2026-09-16", quotes: [{ at: "2026-09-10", unit: "bag", pack: 100, incoterm: "EXW", uncertain: true, breaks: [[3000, 3.48]], moq: 3000, valid: "2026-10-15", dev: "states 80/100 µm film" }] },
    { line: "REQ-2026-0312-01", sup: "SUP-0010", status: "quoted", first: "2026-09-06", last: "2026-09-20", quotes: [{ at: "2026-09-12", unit: "pack", pack: 100, incoterm: "FOB", port: "Shenzhen", breaks: [[1000, 7.45]], moq: 1000, lead: 40, leadMax: 45, valid: "2026-10-20" }] },
    { line: "REQ-2026-0312-01", sup: "SUP-0011", status: "backup", reason: "safe 10/10 fallback, 2.5×", first: "2026-09-07", last: "2026-09-14", quotes: [{ at: "2026-09-14", incoterm: "FOB", port: "Shenzhen", breaks: [[100000, 0.076]], moq: 100000, lead: 40, valid: "2026-10-31", file: "QuoteD-anon.xlsx" }] },
    { line: "REQ-2026-0312-01", sup: "SUP-0012", status: "contacted", first: "2026-09-05", last: "2026-09-18" },
    { line: "REQ-2026-0312-01", sup: "SUP-0013", status: "contacted", first: "2026-09-13", last: "2026-09-13" },
    { line: "REQ-2026-0312-01", sup: "SUP-0014", status: "cannot_make", reason: "metal only", first: "2026-09-05", last: "2026-09-05" },
    { line: "REQ-2026-0312-01", sup: "SUP-0017", status: "quoted", first: "2026-09-08", last: "2026-09-12", quotes: [{ at: "2026-09-12", incoterm: "FOB", uncertain: true, port: "Shenzhen", breaks: [[100000, 0.05]], moq: 100000, lead: 30, valid: "2026-09-20", file: "ZZLEAKTEST-quote.xlsx" }] },
    { line: "REQ-2026-0312-02", sup: "SUP-0007", status: "selected", first: "2026-09-05", last: "2026-09-26", quotes: [{ at: "2026-09-15", incoterm: "FOB", port: "Shenzhen", breaks: [[100000, 0.045]], moq: 100000, lead: 30, valid: "2026-09-30", weight: 0.51 }] },
    { line: "REQ-2026-0312-02", sup: "SUP-0008", status: "dropped", reason: "trader", first: "2026-09-05", last: "2026-09-05", quotes: [{ at: "2026-09-06", incoterm: "FOB", port: "Ningbo", breaks: [[100000, 0.028]], moq: 100000, valid: "2026-09-08" }] },
    { line: "REQ-2026-0312-02", sup: "SUP-0009", status: "quoted", first: "2026-09-06", last: "2026-09-16", quotes: [{ at: "2026-09-10", incoterm: "EXW", uncertain: true, breaks: [[100000, 0.03]], moq: 100000, valid: "2026-10-15" }] },
    { line: "REQ-2026-0312-03", sup: "SUP-0007", status: "negotiating", first: "2026-09-05", last: "2026-09-22", quotes: [{ at: "2026-09-15", incoterm: "FOB", port: "Shenzhen", breaks: [[50000, 0.052]], moq: 50000, lead: 30, valid: "2026-09-30" }] },
    { line: "REQ-2026-0312-03", sup: "SUP-0008", status: "dropped", reason: "trader", first: "2026-09-05", last: "2026-09-05", quotes: [{ at: "2026-09-06", incoterm: "FOB", port: "Ningbo", breaks: [[50000, 0.033]], moq: 50000, valid: "2026-09-08" }] },
    { line: "REQ-2026-0312-05", sup: "SUP-0007", status: "quoted", first: "2026-09-05", last: "2026-09-23", quotes: [{ at: "2026-09-15", incoterm: "FOB", port: "Shenzhen", breaks: [[50000, 0.0083]], moq: 50000, lead: 30, valid: "2026-09-30", dev: "declared 50 µm — deviation vs spec", weight: 0.2 }] },
    { line: "REQ-2026-0312-11", sup: "SUP-0007", status: "quoted", first: "2026-09-05", last: "2026-09-24", quotes: [{ at: "2026-09-15", incoterm: "FOB", port: "Shenzhen", breaks: [[20000, 0.15]], moq: 20000, lead: 30, valid: "2026-09-30" }] },
    { line: "REQ-2026-0312-11", sup: "SUP-0008", status: "quoted", first: "2026-09-05", last: "2026-09-06", quotes: [{ at: "2026-09-06", incoterm: "FOB", port: "Ningbo", breaks: [[20000, 0.14]], moq: 20000, valid: "2026-09-08" }] },
    { line: "REQ-2026-0312-11", sup: "SUP-0012", status: "contacted", first: "2026-09-18", last: "2026-09-18" },
    { line: "REQ-2026-0312-14", sup: "SUP-0007", status: "contacted", first: "2026-09-12", last: "2026-09-12" },
    { line: "REQ-2026-0312-14", sup: "SUP-0012", status: "contacted", first: "2026-09-12", last: "2026-09-12" },
    { line: "REQ-2026-0312-20", sup: "SUP-0007", status: "quoted", first: "2026-09-05", last: "2026-09-23", quotes: [{ at: "2026-09-15", incoterm: "FOB", port: "Shenzhen", breaks: [[5000, 2.1]], moq: 5000, lead: 35, valid: "2026-09-30" }] },
    { line: "REQ-2026-0318-01", sup: "SUP-0005", status: "quoted", first: "2026-09-15", last: "2026-09-16", quotes: [{ at: "2026-09-16", incoterm: "FOB", port: "Ningbo", breaks: [[2000, 59.99]], moq: 500, lead: 45, valid: "2026-10-31", dev: "962 tips, not 507" }] },
    { line: "REQ-2026-0318-01", sup: "SUP-0006", status: "quoted", first: "2026-09-15", last: "2026-09-16", quotes: [{ at: "2026-09-16", currency: "CNY", incoterm: "EXW", port: "Dongyang", breaks: [[2000, 254]], moq: 1000, lead: 40, valid: "2026-10-31" }] },
    { line: "REQ-2026-0321-01", sup: "SUP-0015", status: "cannot_make", reason: "makes plastic sheds only", first: "2026-09-20", last: "2026-09-22" },
    { line: "REQ-2026-0321-01", sup: "SUP-0001", status: "quoted", first: "2026-09-20", last: "2026-09-25", quotes: [{ at: "2026-09-25", incoterm: "FOB", port: "Qingdao", breaks: [[200, 183]], moq: 100, lead: 45, valid: "2026-11-15", terms: "50/50 or 30/70 +$0.1/set" }] },
    { line: "REQ-2026-0321-02", sup: "SUP-0016", status: "quoted", first: "2026-09-20", last: "2026-09-25", quotes: [{ at: "2026-09-25", incoterm: "FOB", port: "Ningbo", breaks: [[200, 96]], moq: 100, lead: 40, valid: "2026-11-15" }] },
    { line: "REQ-2026-0321-03", sup: "SUP-0001", status: "contacted", first: "2026-09-25", last: "2026-09-25" },
  ];
  const partId: Record<string, string> = {};
  const quoteDocs: { line: string; file: string; at: string }[] = [];
  for (const p of parts) {
    const pid = id(); partId[`${p.line}:${p.sup}`] = pid;
    await db.insert(S.supplierParticipations).values({ id: pid, requestLineId: LINE(p.line), supplierId: SUP(p.sup), contactId: contactIds[`${p.sup}:${p.contact ?? 0}`] ?? null, status: p.status, reason: p.reason ?? null, firstContactAt: d(p.first), lastContactAt: d(p.last), createdBy: U("bogdan"), createdAt: d(p.first), updatedAt: d(p.last) });
    bump("supplier_participations");
    for (const [i, q] of (p.quotes ?? []).entries()) {
      const qid = id();
      const currency = q.currency ?? "USD";
      const lineUnit = lines.find((l) => l.ref === p.line)!.unit;
      const top = q.breaks[q.breaks.length - 1][1];
      const perUnit = q.pack ? top / q.pack : top;
      const usd = currency === "CNY" ? perUnit / 6.6933 : perUnit;
      await db.insert(S.quotes).values({ id: qid, participationId: pid, version: i + 1, currency, unit: q.unit ?? lineUnit, packQty: q.pack ?? null, incoterm: q.incoterm, incotermUncertain: !!q.uncertain, port: q.port ?? null, moq: q.moq ?? null, leadDays: q.lead ?? null, leadDaysMax: q.leadMax ?? null, validUntil: q.valid, paymentTerms: q.terms ?? null, deviations: q.dev ?? null, unitWeightG: q.weight ?? null, normalisedUsdMinorE2: e2(usd), fxRate: currency === "CNY" ? 6.6933 : 1, fxDate: currency === "CNY" ? "2026-09-21" : null, flags: q.flags ?? [], receivedAt: d(q.at), createdBy: U("bogdan"), createdAt: d(q.at) });
      bump("quotes");
      for (const [minQty, price] of q.breaks) { await db.insert(S.quotePriceBreaks).values({ id: id(), quoteId: qid, minQty, unitPriceMinorE2: e2(price) }); bump("quote_price_breaks"); }
      if (q.file) quoteDocs.push({ line: p.line, file: q.file, at: q.at });
    }
  }
  // selected/backup pointers
  for (const p of parts) {
    if (p.status === "selected") await db.update(A.requestLines).set({ selectedParticipationId: partId[`${p.line}:${p.sup}`] as never }).where(eq(A.requestLines.id, LINE(p.line)));
    if (p.status === "backup") await db.update(A.requestLines).set({ backupParticipationId: partId[`${p.line}:${p.sup}`] as never }).where(eq(A.requestLines.id, LINE(p.line)));
  }
  await db.insert(A.rfqs).values({ id: id(), requestId: REQ("REQ-2026-0312"), requestLineId: LINE("REQ-2026-0312-14"), orgId: PIOTR.id, version: 1, sentAt: d("2026-09-12"), recipientsCount: 2, createdBy: U("bogdan"), createdAt: d("2026-09-12") });
  bump("rfqs");

  /* 7.8 offers */
  type Opt = { label: "A" | "B"; part: string; breaks: [number, number][]; moq: number; lead: number; fee: number; factory: number; dev: string; sampleCost?: number; samplePaidBy?: "client"; sampleRequired: boolean; terms?: string };
  type Off = { ref: string; line: string; status: "sent" | "accepted"; sent: string; decided?: string; valid: string; incoterm: string; port: string; options: Opt[] };
  const offs: Off[] = [
    { ref: "OFR-2026-0290-01-v1", line: "REQ-2026-0290-01", status: "accepted", sent: "2026-06-14", decided: "2026-06-15", valid: "2026-06-30", incoterm: "FOB", port: "Qingdao", options: [{ label: "A", part: "REQ-2026-0290-01:SUP-0001", breaks: [[500, 8.2], [1000, 7.52]], moq: 500, lead: 35, fee: 300, factory: 6.9, dev: "none", terms: "30 % deposit + fee on order, 70 % after QC pass", sampleRequired: false }] },
    { ref: "OFR-2026-0301-01-v1", line: "REQ-2026-0301-01", status: "sent", sent: "2026-09-26", valid: "2026-10-10", incoterm: "FOB", port: "Ningbo", options: [{ label: "A", part: "REQ-2026-0301-01:SUP-0003", breaks: [[10000, 0.26]], moq: 10000, lead: 25, fee: 150, factory: 0.205, dev: "none; EN 388 2121X on request", terms: "30 % deposit + fee on order, 70 % after QC pass", sampleRequired: false }] },
    { ref: "OFR-2026-0312-01-v1", line: "REQ-2026-0312-01", status: "accepted", sent: "2026-09-08", decided: "2026-09-08", valid: "2026-09-22", incoterm: "FOB", port: "Shenzhen", options: [
      { label: "A", part: "REQ-2026-0312-01:SUP-0007", breaks: [[100000, 0.062]], moq: 100000, lead: 30, fee: 540, factory: 0.0539, dev: "none at spec thickness", sampleCost: 45, samplePaidBy: "client", sampleRequired: true, terms: "30 % deposit + fee on order, 70 % after QC pass" },
      { label: "B", part: "REQ-2026-0312-01:SUP-0011", breaks: [[100000, 0.085]], moq: 100000, lead: 40, fee: 540, factory: 0.076, dev: "supplier declares 10/10 SKUs; thickness to verify on sample", sampleRequired: true, terms: "30 % deposit + fee on order, 70 % after QC pass" },
    ] },
    { ref: "OFR-2026-0312-02-v1", line: "REQ-2026-0312-02", status: "accepted", sent: "2026-09-18", decided: "2026-09-19", valid: "2026-10-02", incoterm: "FOB", port: "Shenzhen", options: [{ label: "A", part: "REQ-2026-0312-02:SUP-0007", breaks: [[100000, 0.052]], moq: 100000, lead: 30, fee: 450, factory: 0.045, dev: "none", sampleCost: 45, samplePaidBy: "client", sampleRequired: true, terms: "30 % deposit + fee on order, 70 % after QC pass" }] },
  ];
  for (const o of offs) {
    const oid = id(); ids[o.ref] = oid;
    const org = lineOrg[o.line];
    const optIds: Record<string, string> = {};
    await db.insert(A.offers).values({ id: oid, ref: o.ref, orgId: org, requestLineId: LINE(o.line), version: 1, status: o.status, pricingDisplay: "factory_plus_fee", incoterm: o.incoterm, port: o.port, validUntil: o.valid, sentAt: d(o.sent), decidedAt: o.decided ? d(o.decided) : null, decidedBy: o.decided ? (org === KOFF.id ? U("anna") : U("piotr")) : null, createdBy: U("bogdan"), createdAt: d(o.sent), updatedAt: d(o.decided ?? o.sent) });
    bump("offers");
    for (const op of o.options) {
      const optId = id(); optIds[op.label] = optId;
      const breaks: PriceBreak[] = op.breaks.map(([min_qty, price]) => ({ min_qty, unit_price_minor_e2: e2(price) }));
      await db.insert(A.offerOptions).values({ id: optId, offerId: oid, label: op.label, participationId: partId[op.part] as never, unit: lines.find((l) => l.ref === o.line)!.unit, moq: op.moq, leadDays: op.lead, priceBreaks: breaks, feeMinor: minor(op.fee), factoryPriceMinorE2: e2(op.factory), deviationsPlain: op.dev, sampleCostMinor: op.sampleCost ? minor(op.sampleCost) : null, samplePaidBy: op.samplePaidBy ?? null, sampleRequired: op.sampleRequired, paymentTermsClient: op.terms ?? null, createdAt: d(o.sent) });
      bump("offer_options");
    }
    if (o.status === "accepted") await db.update(A.offers).set({ acceptedOptionId: optIds.A }).where(eq(A.offers.id, oid));
  }

  /* 7.9 samples (+ sample payments) */
  const smps = [
    { ref: "SMP-2026-0312-01-1", line: "REQ-2026-0312-01", status: "approved" as const, ordered: "2026-09-10", shipped: "2026-09-15", received: "2026-09-18", decided: "2026-09-19", tracking: "JD014600012345678890", paid: "2026-09-11", payRef: "WIRE-0911" },
    { ref: "SMP-2026-0312-02-1", line: "REQ-2026-0312-02", status: "received" as const, ordered: "2026-09-20", shipped: "2026-09-23", received: "2026-09-26", tracking: "JD014600012345678901", paid: "2026-09-21", payRef: "WIRE-0921" },
  ];
  for (const s of smps) {
    const sid = id(); ids[s.ref] = sid;
    await db.insert(A.samples).values({ id: sid, ref: s.ref, orgId: PIOTR.id, requestLineId: LINE(s.line), participationId: partId[`${s.line}:SUP-0007`] as never, status: s.status, costMinor: minor(45), currency: "USD", paidBy: "client", courier: "DHL", tracking: s.tracking, orderedAt: d(s.ordered), shippedAt: d(s.shipped), receivedAt: d(s.received), decidedAt: s.decided ? d(s.decided) : null, decidedBy: s.decided ? U("piotr") : null, approvedBy: s.decided ? U("piotr") : null, approvedAt: s.decided ? d(s.decided) : null, createdBy: U("bogdan"), createdAt: d(s.ordered), updatedAt: d(s.decided ?? s.received) });
    await db.insert(A.payments).values({ id: id(), orgId: PIOTR.id, requestLineId: LINE(s.line), kind: "sample", amountMinor: minor(45), currency: "USD", payee: "agency", status: "paid", dueOn: s.ordered, paidAt: d(s.paid), reference: s.payRef, recordedBy: U("bogdan"), createdBy: U("bogdan"), createdAt: d(s.ordered), updatedAt: d(s.paid) });
    bump("samples"); bump("payments");
  }

  /* 7.10 orders */
  const ORD0290 = id(); ids["ORD-2026-0290"] = ORD0290;
  await db.insert(A.orders).values({ id: ORD0290, ref: "ORD-2026-0290", orgId: KOFF.id, requestId: REQ("REQ-2026-0290"), offerId: ids["OFR-2026-0290-01-v1"], commercialMode: "agency_passthrough", pricingDisplay: "factory_plus_fee", incoterm: "FOB", port: "Qingdao", piNumber: "PI-ORD-2026-0290", state: "delivered", milestone: "delivered", confirmedAt: d("2026-06-15"), deliveredAt: d("2026-08-28"), totalMinor: minor(7820), currency: "USD", depositPct: 30, assignedAgentId: U("bogdan"), lastStateChangeAt: d("2026-08-28"), createdBy: U("bogdan"), createdAt: d("2026-06-15"), updatedAt: d("2026-08-28") });
  const OL0290 = id();
  await db.insert(A.orderLines).values({ id: OL0290, orderId: ORD0290, requestLineId: LINE("REQ-2026-0290-01"), productId: PRD("PRD-0001"), specVersion: 2, lineNo: 1, qty: 1000, unit: "set", unitPriceMinorE2: e2(7.52), feeMinor: minor(300), factoryUnitPriceMinorE2: e2(6.9), participationId: partId["REQ-2026-0290-01:SUP-0001"] as never, artworkRequired: false, createdAt: d("2026-06-15") });
  for (const [kind, pct, amount, due, paid, ref] of [["deposit", 30, 2256, "2026-06-20", "2026-06-20", "WIRE-0620"], ["fee", null, 300, "2026-06-20", "2026-06-20", "WIRE-0620"], ["balance", 70, 5264, "2026-07-13", "2026-07-09", "WIRE-0709"]] as const) {
    await db.insert(A.payments).values({ id: id(), orgId: KOFF.id, orderId: ORD0290, kind, pct, amountMinor: minor(amount), currency: "USD", payee: "agency", status: "paid", dueOn: due, paidAt: d(paid), reference: ref, recordedBy: U("bogdan"), createdBy: U("bogdan"), createdAt: d("2026-06-15"), updatedAt: d(paid) }); bump("payments");
  }
  const PO0290 = id();
  await db.insert(S.purchaseOrders).values({ id: PO0290, ref: "PO-2026-0290-01", orgId: KOFF.id, orderId: ORD0290, supplierId: SUP("SUP-0001"), factoryTotalMinor: minor(6900), currency: "USD", terms: "30/70 T/T", exworksEta: "2026-07-10", status: "completed", issuedAt: d("2026-06-20"), createdBy: U("bogdan"), createdAt: d("2026-06-15"), updatedAt: d("2026-08-28") });
  await db.update(A.orderLines).set({ poId: PO0290 as never }).where(eq(A.orderLines.id, OL0290));
  const INSP0290 = id();
  await db.insert(A.inspections).values({ id: INSP0290, orgId: KOFF.id, orderId: ORD0290, poId: PO0290 as never, inspector: "Bogdan", scheduledFor: "2026-07-08", inspectedAt: d("2026-07-08"), aql: "2.5", sampleSize: 125, result: "pass", defectsNote: "0 critical, 3 minor", visibleToClient: true, createdBy: U("bogdan"), createdAt: d("2026-07-06"), updatedAt: d("2026-07-08") });
  const SHIP0290 = id();
  await db.insert(A.shipments).values({ id: SHIP0290, orgId: KOFF.id, orderId: ORD0290, forwarder: "Rohlig Suus (client)", forwarderParty: "client", bookingRef: "RS-2026-07-4471", mode: "sea", containerOrAwb: "MSKU4471021", cargoReady: "2026-07-10", exworksShippedAt: d("2026-07-11"), etd: "2026-07-14", etaPort: "2026-08-26", portOfDischarge: "Gdańsk", arrivedPortAt: d("2026-08-26"), customsStatus: "cleared", deliveredAt: d("2026-08-28"), createdBy: U("bogdan"), createdAt: d("2026-07-10"), updatedAt: d("2026-08-28") });
  bump("orders"); bump("order_lines"); bump("purchase_orders"); bump("inspections"); bump("shipments");

  const ORD0312 = id(); ids["ORD-2026-0312"] = ORD0312;
  await db.insert(A.orders).values({ id: ORD0312, ref: "ORD-2026-0312", orgId: PIOTR.id, requestId: REQ("REQ-2026-0312"), offerId: ids["OFR-2026-0312-01-v1"], commercialMode: "agency_passthrough", pricingDisplay: "factory_plus_fee", incoterm: "FOB", port: "Shenzhen", piNumber: "PI-ORD-2026-0312", state: "in_production", milestone: "in_production", confirmedAt: d("2026-09-20"), totalMinor: minor(6740), currency: "USD", depositPct: 30, assignedAgentId: U("bogdan"), lastStateChangeAt: d("2026-09-23"), createdBy: U("bogdan"), createdAt: d("2026-09-20"), updatedAt: d("2026-09-23") });
  const OL0312 = id();
  await db.insert(A.orderLines).values({ id: OL0312, orderId: ORD0312, requestLineId: LINE("REQ-2026-0312-01"), productId: PRD("PRD-0004"), specVersion: 1, lineNo: 1, qty: 100000, unit: "pcs", unitPriceMinorE2: e2(0.062), feeMinor: minor(540), factoryUnitPriceMinorE2: e2(0.0539), participationId: partId["REQ-2026-0312-01:SUP-0007"] as never, artworkRequired: true, createdAt: d("2026-09-20") });
  for (const [kind, pct, amount, due, paid, ref] of [["deposit", 30, 1860, "2026-09-25", "2026-09-22", "WIRE-0922-A"], ["fee", null, 540, "2026-09-25", "2026-09-22", "WIRE-0922-A"], ["balance", 70, 4340, null, null, null]] as const) {
    await db.insert(A.payments).values({ id: id(), orgId: PIOTR.id, orderId: ORD0312, kind, pct, amountMinor: minor(amount), currency: "USD", payee: "agency", status: paid ? "paid" : "pending", dueOn: due, paidAt: paid ? d(paid) : null, reference: ref, recordedBy: paid ? U("bogdan") : null, createdBy: U("bogdan"), createdAt: d("2026-09-20"), updatedAt: d(paid ?? "2026-09-20") }); bump("payments");
  }
  const PO0312 = id();
  await db.insert(S.purchaseOrders).values({ id: PO0312, ref: "PO-2026-0312-01", orgId: PIOTR.id, orderId: ORD0312, supplierId: SUP("SUP-0007"), factoryTotalMinor: minor(5390), currency: "USD", terms: "T/T 30/70", exworksEta: "2026-10-25", status: "in_production", issuedAt: d("2026-09-21"), createdBy: U("bogdan"), createdAt: d("2026-09-20"), updatedAt: d("2026-09-23") });
  await db.update(A.orderLines).set({ poId: PO0312 as never }).where(eq(A.orderLines.id, OL0312));
  await db.insert(A.inspections).values({ id: id(), orgId: PIOTR.id, orderId: ORD0312, poId: PO0312 as never, inspector: "Cristina", scheduledFor: "2026-10-22", visibleToClient: false, createdBy: U("bogdan"), createdAt: d("2026-09-23"), updatedAt: d("2026-09-23") });
  await db.insert(A.shipments).values({ id: id(), orgId: PIOTR.id, orderId: ORD0312, mode: "sea", etaPort: "2026-11-18", portOfDischarge: "Gdańsk", customsStatus: "not_started", createdBy: U("bogdan"), createdAt: d("2026-09-23"), updatedAt: d("2026-09-23") });
  bump("orders"); bump("order_lines"); bump("purchase_orders"); bump("inspections"); bump("shipments");

  /* 7.14 documents (placeholder files on disk) + 7.11 factory range */
  const docIds: Record<string, string> = {};
  const doc = async (key: string, p: { entity: EntityType; entityId: string; org: string; filename: string; kind: DocumentKind; visibility: Visibility; by: string; at: string; publishedAt?: string }) => {
    const { data, mime } = await fileBody(p.filename);
    const r = await storeDocument(db, { orgId: p.org, userId: U(p.by), actorName: NAME[U(p.by)], data, mime, filename: p.filename, entity: p.entity, entityId: p.entityId, kind: p.kind, visibility: p.visibility, at: d(p.at) });
    if (p.publishedAt) await db.update(A.documents).set({ publishedAt: d(p.publishedAt), publishedBy: U(p.by) }).where(eq(A.documents.id, r.documentId));
    docIds[key] = r.documentId; bump("documents"); bump("files");
    return r;
  };
  const L01 = LINE("REQ-2026-0312-01");
  await doc("order312list", { entity: "request", entityId: REQ("REQ-2026-0312"), org: PIOTR.id, filename: "Order-312-list.xlsx", kind: "other", visibility: "client", by: "piotr", at: "2026-09-01" });
  await doc("sleeves-ref", { entity: "request_line", entityId: L01, org: PIOTR.id, filename: "allegro-sleeves-ref.jpg", kind: "reference_image", visibility: "client", by: "piotr", at: "2026-09-01" });
  for (const q of quoteDocs) {
    const r = await doc(`quote:${q.file}`, { entity: "request_line", entityId: LINE(q.line), org: lineOrg[q.line], filename: q.file, kind: "quote_file", visibility: "internal", by: "bogdan", at: q.at });
    // link the quote row to its source file
    const p = parts.find((pp) => pp.quotes?.some((qq) => qq.file === q.file))!;
    const [qrow] = await db.select({ id: S.quotes.id }).from(S.quotes).where(eq(S.quotes.participationId, partId[`${p.line}:${p.sup}`])).limit(1);
    if (qrow) await db.update(S.quotes).set({ sourceDocumentId: r.documentId }).where(eq(S.quotes.id, qrow.id));
  }
  await doc("best-prices", { entity: "request_line", entityId: L01, org: PIOTR.id, filename: "Best-prices-sleeves.xlsx", kind: "comparison", visibility: "internal", by: "marko", at: "2026-09-21" });
  await doc("rfq0312", { entity: "request_line", entityId: L01, org: PIOTR.id, filename: "RFQ-0312-v1.pdf", kind: "rfq", visibility: "internal", by: "bogdan", at: "2026-09-05" });
  await doc("wa-yuantuo", { entity: "request_line", entityId: L01, org: PIOTR.id, filename: "wa-yuantuo-0914.png", kind: "other", visibility: "internal", by: "bogdan", at: "2026-09-14" });
  await doc("sample-photo-1", { entity: "sample", entityId: ids["SMP-2026-0312-01-1"], org: PIOTR.id, filename: "Sample-photo-1.jpg", kind: "sample_photo", visibility: "client", by: "bogdan", at: "2026-09-18" });
  await doc("sample-photo-2", { entity: "sample", entityId: ids["SMP-2026-0312-01-1"], org: PIOTR.id, filename: "Sample-photo-2.jpg", kind: "sample_photo", visibility: "client", by: "bogdan", at: "2026-09-18" });
  await doc("pi0312", { entity: "order", entityId: ORD0312, org: PIOTR.id, filename: "PI-ORD-2026-0312.pdf", kind: "pi", visibility: "client", by: "bogdan", at: "2026-09-20", publishedAt: "2026-09-20" });
  await doc("dieline0312", { entity: "order", entityId: ORD0312, org: PIOTR.id, filename: "Dieline-sleeve-66x91.pdf", kind: "dieline", visibility: "client", by: "bogdan", at: "2026-09-20", publishedAt: "2026-09-20" });
  await doc("artwork0312", { entity: "order", entityId: ORD0312, org: PIOTR.id, filename: "Artwork-sleeves-v1.pdf", kind: "artwork", visibility: "client", by: "piotr", at: "2026-09-22" });
  await doc("po0312", { entity: "order", entityId: ORD0312, org: PIOTR.id, filename: "PO-2026-0312-01.pdf", kind: "other", visibility: "internal", by: "bogdan", at: "2026-09-21" });
  await doc("zzleak-order", { entity: "order", entityId: ORD0312, org: PIOTR.id, filename: "ZZLEAKTEST-quote.xlsx", kind: "quote_file", visibility: "internal", by: "bogdan", at: "2026-09-21" });
  await db.update(S.purchaseOrders).set({ documentId: docIds.po0312 }).where(eq(S.purchaseOrders.id, PO0312));
  const art0312 = id();
  await db.insert(A.artworks).values({ id: art0312, orgId: PIOTR.id, orderLineId: OL0312, version: 1, fileId: (await db.select({ fileId: A.documents.fileId }).from(A.documents).where(eq(A.documents.id, docIds.artwork0312)))[0].fileId, dielineFileId: (await db.select({ fileId: A.documents.fileId }).from(A.documents).where(eq(A.documents.id, docIds.dieline0312)))[0].fileId, status: "approved", decidedAt: d("2026-09-23"), decidedBy: U("bogdan"), approvedBy: U("bogdan"), createdBy: U("piotr"), createdAt: d("2026-09-22"), updatedAt: d("2026-09-23") });
  bump("artworks");
  for (const [key, filename, kind] of [["pi0290", "PI-ORD-2026-0290.pdf", "pi"], ["inv0290", "Invoice-ORD-2026-0290-balance.pdf", "invoice"], ["qc0290", "QC-report-ORD-2026-0290.pdf", "qc_report"], ["bl0290", "BL-ORD-2026-0290.pdf", "bill_of_lading"], ["pl0290", "Packing-list-ORD-2026-0290.pdf", "packing_list"]] as const) {
    await doc(key, { entity: "order", entityId: ORD0290, org: KOFF.id, filename, kind, visibility: "client", by: "bogdan", at: kind === "pi" ? "2026-06-15" : kind === "invoice" ? "2026-07-08" : kind === "qc_report" ? "2026-07-08" : "2026-07-15", publishedAt: kind === "pi" ? "2026-06-15" : kind === "invoice" ? "2026-07-08" : kind === "qc_report" ? "2026-07-08" : "2026-07-15" });
  }
  await doc("po0290", { entity: "order", entityId: ORD0290, org: KOFF.id, filename: "PO-2026-0290-01.pdf", kind: "other", visibility: "internal", by: "bogdan", at: "2026-06-20" });
  await doc("ecosino-quote", { entity: "order", entityId: ORD0290, org: KOFF.id, filename: "Ecosino-quote-2026-06.xlsx", kind: "quote_file", visibility: "internal", by: "bogdan", at: "2026-06-09" });
  await db.update(A.inspections).set({ reportDocumentId: docIds.qc0290 }).where(eq(A.inspections.id, INSP0290));
  await db.update(A.shipments).set({ blDocumentId: docIds.bl0290, packingListDocumentId: docIds.pl0290 }).where(eq(A.shipments.id, SHIP0290));
  await db.update(S.purchaseOrders).set({ documentId: docIds.po0290 }).where(eq(S.purchaseOrders.id, PO0290));

  // factory range FR-0001 → Factory F-0042
  const FR = id(); ids["FR-0001"] = FR;
  await db.insert(A.factoryRanges).values({ id: FR, ref: "FR-0001", orgId: PIOTR.id, supplierId: SUP("SUP-0007") as never, label: "F-0042", approvedBy: U("marko"), publishedAt: d("2026-09-21"), leakCheckResult: { ok: true, at: d("2026-09-21").toISOString(), hits: [] }, createdBy: U("marko"), createdAt: d("2026-09-20"), updatedAt: d("2026-09-21") });
  const rangePdf = await doc("range-pdf", { entity: "factory_range", entityId: FR, org: PIOTR.id, filename: "Factory-F-0042-range.pdf", kind: "factory_range_pdf", visibility: "client", by: "marko", at: "2026-09-21", publishedAt: "2026-09-21" });
  await db.update(A.factoryRanges).set({ pdfFileId: rangePdf.file.id }).where(eq(A.factoryRanges.id, FR));
  const items: [string, number, number, string, boolean | null][] = [
    ["Standard sleeves 66×91 100 µm", 100000, 0.058, "pcs", true], ["Standard sleeves 66×91 80 µm", 100000, 0.049, "pcs", true], ["Standard sleeves 66×91 60 µm", 100000, 0.041, "pcs", true],
    ["Japanese 62×89 100 µm", 50000, 0.056, "pcs", true], ["Team bag 66×91", 50000, 0.0095, "pcs", true], ["Toploader 35pt", 20000, 0.16, "pcs", true], ["Toploader 55pt", 20000, 0.19, "pcs", true],
    ["Toploader 100pt", 10000, 0.28, "pcs", true], ["Toploader 130pt", 5000, 0.34, "pcs", true], ["Magnetic holder 35pt", 5000, 2.25, "pcs", null], ["Deck box 100+", 3000, 0.95, "pcs", false], ["Binder 9-pocket 360", 2000, 6.8, "pcs", null],
  ];
  for (const [i, [name, moq, price, unit, madeHere]] of items.entries()) { await db.insert(A.factoryRangeItems).values({ id: id(), rangeId: FR, name, moq, priceMinorE2: e2(price), currency: "USD", unit, madeHere, sortOrder: i, note: madeHere === false ? "sourced by them" : null, createdAt: d("2026-09-21") }); bump("factory_range_items"); }
  bump("factory_ranges");

  // supplier price lists / catalogues (internal documents attached to the supplier)
  const pl17 = await doc("zzleak-pricelist", { entity: "supplier", entityId: SUP("SUP-0017"), org: AGENCY.id, filename: "ZZLEAKTEST-pricelist-2026.pdf", kind: "price_list", visibility: "internal", by: "bogdan", at: "2026-09-12" });
  await db.insert(S.supplierPriceLists).values({ id: id(), supplierId: SUP("SUP-0017"), documentId: pl17.documentId, receivedAt: d("2026-09-12"), currency: "USD", notes: "ZZLEAKTEST canary price list" });
  const pl07 = await doc("yuantuo-pricelist", { entity: "supplier", entityId: SUP("SUP-0007"), org: AGENCY.id, filename: "Yuantuo-pricelist-2026.pdf", kind: "price_list", visibility: "internal", by: "bogdan", at: "2026-09-05" });
  await db.insert(S.supplierPriceLists).values({ id: id(), supplierId: SUP("SUP-0007"), documentId: pl07.documentId, receivedAt: d("2026-09-05"), currency: "USD" });
  const cat01 = await doc("ecosino-catalogue", { entity: "supplier", entityId: SUP("SUP-0001"), org: AGENCY.id, filename: "Ecosino-catalogue-2026.pdf", kind: "catalogue", visibility: "internal", by: "bogdan", at: "2026-06-03" });
  await db.insert(S.supplierCatalogues).values({ id: id(), supplierId: SUP("SUP-0001"), documentId: cat01.documentId, receivedAt: d("2026-06-03"), currency: "USD" });
  bump("supplier_price_lists", 2); bump("supplier_catalogues");

  /* 7.13 comments */
  const comment = async (p: { entity: EntityType; entityId: string; org: string; visibility: Visibility; kind: "update" | "question" | "answer" | "note"; source?: "app" | "whatsapp_log"; by: string; at: string; body: string; counterparty?: string; attachments?: string[] }) => {
    const cid = id();
    await db.insert(A.comments).values({ id: cid, orgId: p.org, entityType: p.entity, entityId: p.entityId, authorId: U(p.by), authorName: NAME[U(p.by)], body: p.body, kind: p.kind, visibility: p.visibility, source: p.source ?? "app", counterparty: p.counterparty ?? null, occurredAt: d(p.at), attachments: p.attachments ?? [], createdBy: U(p.by), createdAt: d(p.at), updatedAt: d(p.at) });
    await logActivity(db, { orgId: p.org, entityType: p.entity, entityId: p.entityId, type: p.source === "whatsapp_log" ? "whatsapp_logged" : "comment_posted", actorId: U(p.by), actorName: NAME[U(p.by)], visibility: p.visibility, at: d(p.at), payload: p.visibility === "client" ? { commentId: cid, kind: p.kind } : { commentId: cid, kind: p.kind, counterparty: p.counterparty ?? null } });
    bump("comments");
  };
  await comment({ entity: "request_line", entityId: L01, org: PIOTR.id, visibility: "internal", kind: "note", by: "bogdan", at: "2026-09-06", body: "Suti registered 2026-03, 100k capital — do not use" });
  await comment({ entity: "request_line", entityId: L01, org: PIOTR.id, visibility: "internal", kind: "note", source: "whatsapp_log", by: "bogdan", at: "2026-09-14", counterparty: "Daryl (Yuantuo)", body: "confirmed 0.0539 FOB SZ for 100k, T/T 30/70, 30 days", attachments: [docIds["wa-yuantuo"]] });
  await comment({ entity: "request_line", entityId: L01, org: PIOTR.id, visibility: "internal", kind: "note", by: "bogdan", at: "2026-09-12", body: "ZZLEAKTEST asked for 50 % deposit — parked" });
  await comment({ entity: "request_line", entityId: L01, org: PIOTR.id, visibility: "client", kind: "question", by: "piotr", at: "2026-09-24", body: "Can we get the balance invoice in EUR next time?" });
  await comment({ entity: "request_line", entityId: L01, org: PIOTR.id, visibility: "client", kind: "answer", by: "bogdan", at: "2026-09-24", body: "USD for now; EUR display is coming." });
  await comment({ entity: "request_line", entityId: L01, org: PIOTR.id, visibility: "client", kind: "update", by: "bogdan", at: "2026-09-23", body: "Deposit and fee received, artwork approved — production starts" });
  await comment({ entity: "request_line", entityId: LINE("REQ-2026-0312-05"), org: PIOTR.id, visibility: "client", kind: "update", by: "bogdan", at: "2026-09-23", body: "One factory quoted 50 µm instead of spec — we are asking for the right thickness" });
  await comment({ entity: "request_line", entityId: LINE("REQ-2026-0318-01"), org: KOFF.id, visibility: "internal", kind: "note", source: "whatsapp_log", by: "cristina", at: "2026-09-14", counterparty: "client (KOFF)", body: "Bogdan: Springos lookalike, 180 cm, PVC ok" });
  await comment({ entity: "request_line", entityId: LINE("REQ-2026-0301-01"), org: KOFF.id, visibility: "client", kind: "update", by: "bogdan", at: "2026-09-26", body: "Price ready — includes EN 388 marking on the cuff" });
  await comment({ entity: "order", entityId: ORD0290, org: KOFF.id, visibility: "client", kind: "update", by: "bogdan", at: "2026-08-28", body: "Delivered to your warehouse — please confirm in the app" });
  await comment({ entity: "request", entityId: REQ("REQ-2026-0325"), org: KOFF.id, visibility: "internal", kind: "note", by: "marko", at: "2026-09-27", body: "Bogdan says ASAP; top 10 of this type" });

  /* activity events — state histories (client-visible) + internal board events */
  const ev = async (p: { entity: EntityType; entityId: string; org: string; type: ActivityType; by?: string | null; at: string; time?: string; visibility?: Visibility; payload?: Record<string, unknown> }) => {
    await logActivity(db, { orgId: p.org, entityType: p.entity, entityId: p.entityId, type: p.type, actorId: p.by ? U(p.by) : null, actorName: p.by ? NAME[U(p.by)] : "System", visibility: p.visibility ?? "client", at: d(p.at, p.time), payload: p.payload ?? {} });
    bump("activity_events");
  };
  const stateEv = (entity: EntityType, entityId: string, org: string, ref: string, from: LineState, to: LineState, at: string, extra: Record<string, unknown> = {}, by?: string | null, time?: string) =>
    ev({ entity, entityId, org, type: "state_changed", by, at, time, payload: { ref, from, to, milestone: milestoneFor(to), milestoneChanged: milestoneFor(from) !== milestoneFor(to), feed: isFeedState(to), ...extra } });

  // 7.12 — REQ-2026-0312-01 / ORD-2026-0312 client feed (newest first in the UI; inserted chronologically)
  const R312 = REQ("REQ-2026-0312");
  await ev({ entity: "request", entityId: R312, org: PIOTR.id, type: "request_submitted", by: "piotr", at: "2026-09-01", payload: { ref: "REQ-2026-0312", text: "Received" } });
  for (const l of lines.filter((x) => x.req === "REQ-2026-0312")) await ev({ entity: "request_line", entityId: LINE(l.ref), org: PIOTR.id, type: "line_created", by: "piotr", at: "2026-09-01", time: "09:01", payload: { ref: l.ref, name: l.name, qty: l.qty } });
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "request_submitted", by: "piotr", at: "2026-09-01", time: "09:02", payload: { ref: "REQ-2026-0312-01", text: "Received" } });
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "line_assigned", by: "bogdan", at: "2026-09-02", visibility: "internal", payload: { ref: "REQ-2026-0312-01", agentName: "Bogdan" } });
  await stateEv("request_line", L01, PIOTR.id, "REQ-2026-0312-01", "submitted", "in_review", "2026-09-02", { agentName: "Bogdan", text: "In review — your contact is Bogdan" }, "bogdan");
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "spec_frozen", by: "bogdan", at: "2026-09-03", payload: { ref: "REQ-2026-0312-01", version: 1, summary: "66×91 mm, 100 µm single wall, PP virgin, 100/bag", text: "Spec confirmed: 66×91 mm, 100 µm single wall, PP virgin, 100/bag — Finding factory" } });
  await stateEv("request_line", L01, PIOTR.id, "REQ-2026-0312-01", "in_review", "spec_frozen", "2026-09-03", {}, "bogdan", "09:01");
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "cost_model_saved", by: "bogdan", at: "2026-09-04", visibility: "internal", payload: { ref: "REQ-2026-0312-01", est: 0.031, target: 0.037 } });
  await stateEv("request_line", L01, PIOTR.id, "REQ-2026-0312-01", "spec_frozen", "cost_target_price", "2026-09-04", {}, "bogdan");
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "target_confirmed", by: "bogdan", at: "2026-09-04", time: "09:05", visibility: "internal", payload: { ref: "REQ-2026-0312-01", target: 0.037 } });
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "rfq_sent", by: "bogdan", at: "2026-09-05", visibility: "internal", payload: { ref: "REQ-2026-0312-01", recipients: 8 } });
  await stateEv("request_line", L01, PIOTR.id, "REQ-2026-0312-01", "cost_target_price", "rfq_out", "2026-09-05", {}, "bogdan", "09:01");
  for (const p of parts.filter((x) => x.line === "REQ-2026-0312-01")) {
    await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "participation_added", by: "bogdan", at: p.first, time: "10:00", visibility: "internal", payload: { ref: "REQ-2026-0312-01", supplierRef: p.sup, supplierName: sups.find((s) => s.ref === p.sup)!.legalName } });
    for (const q of p.quotes ?? []) await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "quote_logged", by: "bogdan", at: q.at, time: "11:00", visibility: "internal", payload: { ref: "REQ-2026-0312-01", supplierRef: p.sup, supplierName: sups.find((s) => s.ref === p.sup)!.legalName, price: q.breaks[q.breaks.length - 1][1], currency: q.currency ?? "USD" } });
    if (p.status !== "contacted") await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "participation_status_changed", by: "bogdan", at: p.last, time: "12:00", visibility: "internal", payload: { ref: "REQ-2026-0312-01", supplierRef: p.sup, supplierName: sups.find((s) => s.ref === p.sup)!.legalName, status: p.status, reason: p.reason ?? null } });
  }
  await stateEv("request_line", L01, PIOTR.id, "REQ-2026-0312-01", "rfq_out", "quotes_in", "2026-09-06", {}, null);
  await stateEv("request_line", L01, PIOTR.id, "REQ-2026-0312-01", "quotes_in", "negotiating", "2026-09-07", {}, "bogdan");
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "offer_sent", by: "bogdan", at: "2026-09-08", payload: { ref: "REQ-2026-0312-01", offerRef: "OFR-2026-0312-01-v1", version: 1, text: "Price ready — offer v1" } });
  await stateEv("request_line", L01, PIOTR.id, "REQ-2026-0312-01", "negotiating", "offer_ready", "2026-09-08", {}, "bogdan", "09:01");
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "offer_decided", by: "piotr", at: "2026-09-08", time: "15:00", payload: { ref: "REQ-2026-0312-01", offerRef: "OFR-2026-0312-01-v1", decision: "accepted", option: "A", text: "Offer accepted (Option A)" } });
  await stateEv("request_line", L01, PIOTR.id, "REQ-2026-0312-01", "offer_ready", "sampling", "2026-09-08", {}, "piotr", "15:01");
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "sample_created", by: "bogdan", at: "2026-09-10", payload: { ref: "REQ-2026-0312-01", sampleRef: "SMP-2026-0312-01-1" } });
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "sample_status_changed", by: "bogdan", at: "2026-09-15", payload: { ref: "REQ-2026-0312-01", sampleRef: "SMP-2026-0312-01-1", status: "shipped", courier: "DHL", tracking: "JD014600012345678890", text: "Sample shipped — DHL JD014600012345678890" } });
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "sample_status_changed", by: "bogdan", at: "2026-09-18", payload: { ref: "REQ-2026-0312-01", sampleRef: "SMP-2026-0312-01-1", status: "received", text: "Sample received" } });
  await ev({ entity: "request_line", entityId: L01, org: PIOTR.id, type: "sample_decided", by: "piotr", at: "2026-09-19", payload: { ref: "REQ-2026-0312-01", sampleRef: "SMP-2026-0312-01-1", decision: "approved", text: "Sample approved" } });
  await stateEv("request_line", L01, PIOTR.id, "REQ-2026-0312-01", "sampling", "offer_accepted", "2026-09-19", {}, "piotr", "09:01");
  await ev({ entity: "order", entityId: ORD0312, org: PIOTR.id, type: "order_confirmed", by: "bogdan", at: "2026-09-20", payload: { ref: "ORD-2026-0312", piNumber: "PI-ORD-2026-0312", text: "Order confirmed — invoice PI-ORD-2026-0312 issued" } });
  await stateEv("order", ORD0312, PIOTR.id, "ORD-2026-0312", "offer_accepted", "order_confirmed", "2026-09-20", { piNumber: "PI-ORD-2026-0312", text: "Order confirmed — invoice PI-ORD-2026-0312 issued" }, "bogdan", "09:01");
  await ev({ entity: "order", entityId: ORD0312, org: PIOTR.id, type: "document_published", by: "bogdan", at: "2026-09-20", time: "09:02", payload: { ref: "ORD-2026-0312", kind: "pi", kindLabel: "Proforma invoice" } });
  await stateEv("order", ORD0312, PIOTR.id, "ORD-2026-0312", "order_confirmed", "awaiting_deposit", "2026-09-20", {}, null, "09:03");
  await ev({ entity: "order", entityId: ORD0312, org: PIOTR.id, type: "payment_recorded", by: "bogdan", at: "2026-09-22", payload: { ref: "ORD-2026-0312", kind: "deposit", text: "Deposit received" } });
  await ev({ entity: "order", entityId: ORD0312, org: PIOTR.id, type: "payment_recorded", by: "bogdan", at: "2026-09-22", time: "09:01", payload: { ref: "ORD-2026-0312", kind: "fee", text: "Fee received" } });
  await stateEv("order", ORD0312, PIOTR.id, "ORD-2026-0312", "awaiting_deposit", "awaiting_artwork", "2026-09-22", {}, null, "09:02");
  await ev({ entity: "order", entityId: ORD0312, org: PIOTR.id, type: "artwork_submitted", by: "piotr", at: "2026-09-22", time: "14:00", payload: { ref: "ORD-2026-0312", version: 1 } });
  await ev({ entity: "order", entityId: ORD0312, org: PIOTR.id, type: "artwork_decided", by: "bogdan", at: "2026-09-23", payload: { ref: "ORD-2026-0312", decision: "approved", text: "Artwork approved" } });
  await ev({ entity: "order", entityId: ORD0312, org: PIOTR.id, type: "po_updated", by: "bogdan", at: "2026-09-21", visibility: "internal", payload: { ref: "ORD-2026-0312", poRef: "PO-2026-0312-01", supplierName: "Dongguan Yuantuo Packaging Products Co., Ltd.", status: "issued" } });
  await ev({ entity: "order", entityId: ORD0312, org: PIOTR.id, type: "po_updated", by: "bogdan", at: "2026-09-21", time: "09:30", visibility: "internal", payload: { ref: "ORD-2026-0312", note: "ZZLEAKTEST-quote.xlsx attached for reference — canary; never publish" } });
  await stateEv("order", ORD0312, PIOTR.id, "ORD-2026-0312", "awaiting_artwork", "in_production", "2026-09-23", { eta: "2026-10-25", text: "In production — ex-works ETA 25 Oct 2026" }, "bogdan", "09:05");

  // other REQ-2026-0312 lines (compact histories)
  for (const l of lines.filter((x) => x.req === "REQ-2026-0312" && x.no !== 1)) {
    const lid = LINE(l.ref);
    await ev({ entity: "request_line", entityId: lid, org: PIOTR.id, type: "line_assigned", by: "bogdan", at: "2026-09-02", visibility: "internal", payload: { ref: l.ref, agentName: "Bogdan" } });
    await stateEv("request_line", lid, PIOTR.id, l.ref, "submitted", "in_review", "2026-09-02", { agentName: "Bogdan" }, "bogdan");
    const frozen = l.no === 26 ? "2026-09-17" : "2026-09-03";
    await ev({ entity: "request_line", entityId: lid, org: PIOTR.id, type: "spec_frozen", by: "bogdan", at: frozen, payload: { ref: l.ref, version: 1 } });
    await stateEv("request_line", lid, PIOTR.id, l.ref, "in_review", "spec_frozen", frozen, {}, "bogdan", "09:01");
    const chain: [LineState, string][] = l.state === "spec_frozen" ? [] : l.state === "rfq_out" ? [["cost_target_price", "2026-09-04"], ["rfq_out", l.last]]
      : l.state === "quotes_in" ? [["cost_target_price", "2026-09-04"], ["rfq_out", "2026-09-05"], ["quotes_in", l.last]]
      : l.state === "negotiating" ? [["cost_target_price", "2026-09-04"], ["rfq_out", "2026-09-05"], ["quotes_in", "2026-09-15"], ["negotiating", l.last]]
      : [["cost_target_price", "2026-09-04"], ["rfq_out", "2026-09-05"], ["quotes_in", "2026-09-15"], ["negotiating", "2026-09-16"], ["offer_ready", "2026-09-18"], ["sampling", l.last]];
    let prev: LineState = "spec_frozen";
    for (const [to, at] of chain) { await stateEv("request_line", lid, PIOTR.id, l.ref, prev, to, at, {}, "bogdan", "10:00"); prev = to; }
    if (l.no === 2) {
      await ev({ entity: "request_line", entityId: lid, org: PIOTR.id, type: "offer_sent", by: "bogdan", at: "2026-09-18", payload: { ref: l.ref, offerRef: "OFR-2026-0312-02-v1", version: 1, text: "Price ready — offer v1" } });
      await ev({ entity: "request_line", entityId: lid, org: PIOTR.id, type: "offer_decided", by: "piotr", at: "2026-09-19", payload: { ref: l.ref, offerRef: "OFR-2026-0312-02-v1", decision: "accepted", option: "A", text: "Offer accepted (Option A)" } });
      await ev({ entity: "request_line", entityId: lid, org: PIOTR.id, type: "sample_created", by: "bogdan", at: "2026-09-20", payload: { ref: l.ref, sampleRef: "SMP-2026-0312-02-1" } });
      await ev({ entity: "request_line", entityId: lid, org: PIOTR.id, type: "sample_status_changed", by: "bogdan", at: "2026-09-23", payload: { ref: l.ref, sampleRef: "SMP-2026-0312-02-1", status: "shipped", courier: "DHL", tracking: "JD014600012345678901", text: "Sample shipped — DHL JD014600012345678901" } });
      await ev({ entity: "request_line", entityId: lid, org: PIOTR.id, type: "sample_status_changed", by: "bogdan", at: "2026-09-26", payload: { ref: l.ref, sampleRef: "SMP-2026-0312-02-1", status: "received", text: "Sample received" } });
    }
  }

  // KOFF requests
  const histories: { line: string; org: string; submitted: string; chain: [LineState, string][]; agent?: string; assignedAt?: string }[] = [
    { line: "REQ-2026-0290-01", org: KOFF.id, submitted: "2026-06-01", agent: "Bogdan", assignedAt: "2026-06-02", chain: [["in_review", "2026-06-02"], ["spec_frozen", "2026-06-05"], ["cost_target_price", "2026-06-06"], ["rfq_out", "2026-06-07"], ["quotes_in", "2026-06-09"], ["negotiating", "2026-06-12"], ["offer_ready", "2026-06-14"], ["offer_accepted", "2026-06-15"]] },
    { line: "REQ-2026-0301-01", org: KOFF.id, submitted: "2026-09-10", agent: "Bogdan", assignedAt: "2026-09-11", chain: [["in_review", "2026-09-11"], ["spec_frozen", "2026-09-12"], ["cost_target_price", "2026-09-12"], ["rfq_out", "2026-09-13"], ["quotes_in", "2026-09-20"], ["negotiating", "2026-09-24"], ["offer_ready", "2026-09-26"]] },
    { line: "REQ-2026-0305-01", org: KOFF.id, submitted: "2026-09-12", agent: "Bogdan", assignedAt: "2026-09-13", chain: [["in_review", "2026-09-13"], ["spec_frozen", "2026-09-13"], ["cost_target_price", "2026-09-13"], ["rfq_out", "2026-09-14"], ["quotes_in", "2026-09-17"], ["negotiating", "2026-09-24"]] },
    { line: "REQ-2026-0318-01", org: KOFF.id, submitted: "2026-09-14", agent: "Cristina", assignedAt: "2026-09-14", chain: [["in_review", "2026-09-14"], ["spec_frozen", "2026-09-15"], ["rfq_out", "2026-09-15"], ["quotes_in", "2026-09-16"]] },
    { line: "REQ-2026-0321-01", org: KOFF.id, submitted: "2026-09-18", agent: "Marko", assignedAt: "2026-09-18", chain: [["in_review", "2026-09-18"], ["spec_frozen", "2026-09-19"], ["rfq_out", "2026-09-20"], ["quotes_in", "2026-09-25"]] },
    { line: "REQ-2026-0321-02", org: KOFF.id, submitted: "2026-09-18", agent: "Marko", assignedAt: "2026-09-18", chain: [["in_review", "2026-09-18"], ["spec_frozen", "2026-09-19"], ["rfq_out", "2026-09-20"], ["quotes_in", "2026-09-25"]] },
    { line: "REQ-2026-0321-03", org: KOFF.id, submitted: "2026-09-18", agent: "Marko", assignedAt: "2026-09-18", chain: [["in_review", "2026-09-18"], ["spec_frozen", "2026-09-19"], ["rfq_out", "2026-09-20"], ["quotes_in", "2026-09-25"]] },
    { line: "REQ-2026-0325-01", org: KOFF.id, submitted: "2026-09-27", chain: [] },
  ];
  for (const h of histories) {
    const lid = LINE(h.line);
    const req = lines.find((l) => l.ref === h.line)!.req;
    await ev({ entity: "request", entityId: REQ(req), org: h.org, type: "request_submitted", by: req === "REQ-2026-0318" ? "cristina" : "anna", at: h.submitted, payload: { ref: req, text: "Received" } });
    await ev({ entity: "request_line", entityId: lid, org: h.org, type: "line_created", by: req === "REQ-2026-0318" ? "cristina" : "anna", at: h.submitted, time: "09:01", payload: { ref: h.line } });
    if (h.agent) await ev({ entity: "request_line", entityId: lid, org: h.org, type: "line_assigned", by: h.agent.toLowerCase(), at: h.assignedAt!, visibility: "internal", payload: { ref: h.line, agentName: h.agent } });
    let prev: LineState = "submitted";
    for (const [to, at] of h.chain) {
      const extra = to === "in_review" ? { agentName: h.agent } : {};
      await stateEv("request_line", lid, h.org, h.line, prev, to, at, extra, h.agent?.toLowerCase() ?? null, "10:00");
      if (to === "spec_frozen") await ev({ entity: "request_line", entityId: lid, org: h.org, type: "spec_frozen", by: h.agent!.toLowerCase(), at, time: "09:59", payload: { ref: h.line, version: 1 } });
      prev = to;
    }
  }
  await ev({ entity: "request_line", entityId: LINE("REQ-2026-0301-01"), org: KOFF.id, type: "offer_sent", by: "bogdan", at: "2026-09-26", time: "10:01", payload: { ref: "REQ-2026-0301-01", offerRef: "OFR-2026-0301-01-v1", version: 1, text: "Price ready — offer v1" } });
  await ev({ entity: "request_line", entityId: LINE("REQ-2026-0290-01"), org: KOFF.id, type: "offer_sent", by: "bogdan", at: "2026-06-14", time: "10:01", payload: { ref: "REQ-2026-0290-01", offerRef: "OFR-2026-0290-01-v1", version: 1, text: "Price ready — offer v1" } });
  await ev({ entity: "request_line", entityId: LINE("REQ-2026-0290-01"), org: KOFF.id, type: "offer_decided", by: "anna", at: "2026-06-15", payload: { ref: "REQ-2026-0290-01", offerRef: "OFR-2026-0290-01-v1", decision: "accepted", option: "A", text: "Offer accepted (Option A)" } });
  // ORD-2026-0290 history
  const h0290: [LineState, LineState, string, Record<string, unknown>][] = [
    ["offer_accepted", "order_confirmed", "2026-06-15", { piNumber: "PI-ORD-2026-0290" }], ["order_confirmed", "awaiting_deposit", "2026-06-15", {}], ["awaiting_deposit", "in_production", "2026-06-20", { eta: "2026-07-10" }],
    ["in_production", "qc_inspection", "2026-07-06", {}], ["qc_inspection", "awaiting_balance", "2026-07-08", {}], ["awaiting_balance", "forwarder_booked", "2026-07-10", {}], ["forwarder_booked", "shipped_exworks", "2026-07-11", {}],
    ["shipped_exworks", "departed_origin", "2026-07-14", { etd: "2026-07-14", etaPort: "2026-08-26" }], ["departed_origin", "eu_port_customs", "2026-08-26", {}], ["eu_port_customs", "delivered", "2026-08-28", {}],
  ];
  await ev({ entity: "order", entityId: ORD0290, org: KOFF.id, type: "order_confirmed", by: "bogdan", at: "2026-06-15", payload: { ref: "ORD-2026-0290", piNumber: "PI-ORD-2026-0290", text: "Order confirmed — invoice PI-ORD-2026-0290 issued" } });
  let hour = 10;
  for (const [from, to, at, extra] of h0290) await stateEv("order", ORD0290, KOFF.id, "ORD-2026-0290", from, to, at, extra, "bogdan", `${String(hour++ % 24).padStart(2, "0")}:00`);
  await ev({ entity: "order", entityId: ORD0290, org: KOFF.id, type: "inspection_recorded", by: "bogdan", at: "2026-07-08", time: "09:30", payload: { ref: "ORD-2026-0290", result: "pass", text: "Quality check passed — 0 critical, 3 minor" } });
  for (const [kind, at] of [["deposit", "2026-06-20"], ["fee", "2026-06-20"], ["balance", "2026-07-09"]] as const) await ev({ entity: "order", entityId: ORD0290, org: KOFF.id, type: "payment_recorded", by: "bogdan", at, time: "08:00", payload: { ref: "ORD-2026-0290", kind, text: `${kind[0].toUpperCase()}${kind.slice(1)} received` } });
  await ev({ entity: "order", entityId: ORD0290, org: KOFF.id, type: "shipment_updated", by: "bogdan", at: "2026-07-10", time: "11:00", visibility: "internal", payload: { ref: "ORD-2026-0290", forwarder: "Rohlig Suus (client)", forwarderParty: "client", note: "Supplier SUP-0001 disclosed to KOFF: client forwarder picks up at the factory" } });
  await ev({ entity: "supplier", entityId: SUP("SUP-0001"), org: KOFF.id, type: "shipment_updated", by: "bogdan", at: "2026-07-10", time: "11:01", visibility: "internal", payload: { note: "disclosed_to_org_ids += KOFF (forwarder_party=client on ORD-2026-0290)" } });
  await ev({ entity: "factory_range", entityId: FR, org: PIOTR.id, type: "range_published", by: "marko", at: "2026-09-21", payload: { ref: "FR-0001", factoryLabel: "F-0042", text: "More from this factory is available" } });
  for (const p of prods.filter((x) => x.catalog)) await ev({ entity: "product", entityId: PRD(p.ref), org: AGENCY.id, type: "product_published", by: "marko", at: "2026-09-21", visibility: "internal", payload: { ref: p.ref } });

  /* 7.15 outbox — generated to mirror the histories, then marked sent + written to outbox.log */
  const clientOf = (org: string) => (org === KOFF.id ? ["anna"] : ["piotr"]);
  const q = async (p: { to: string; template: NotificationTemplate; subject: string; ref: string; url: string; at: string; key: string; payload?: Record<string, unknown> }) => {
    await enqueue({ userId: U(p.to), toEmail: users.find((u) => u.key === p.to)!.email, template: p.template, subject: p.subject, entityRef: p.ref, payload: { ref: p.ref, url: p.url, ...(p.payload ?? {}) }, idempotencyKey: `${p.template}:${p.key}:${p.to}`, at: d(p.at) });
    bump("notification_outbox");
  };
  const opsAll = ["marko", "bogdan", "cristina"];
  for (const r of reqs.filter((x) => x.submitted)) {
    const lineCount = lines.filter((l) => l.req === r.ref).length;
    const orgName = r.org === KOFF.id ? "KOFF" : "Piotr's team";
    if (r.source !== "agent_on_behalf") for (const c of clientOf(r.org)) await q({ to: c, template: "client_request_received", subject: `We received your request ${r.ref}`, ref: r.ref, url: `/app/requests/${r.ref}`, at: r.submitted!, key: r.ref });
    for (const a of opsAll) await q({ to: a, template: "ops_new_request", subject: `New request ${r.ref} from ${orgName} (${lineCount} lines)`, ref: r.ref, url: `/ops/requests/${r.ref}`, at: r.submitted!, key: r.ref });
  }
  const milestoneMail = async (org: string, ref: string, name: string, milestone: Milestone, at: string, url: string) => { for (const c of clientOf(org)) await q({ to: c, template: "client_milestone_changed", subject: `${name}: ${milestone.replace(/_/g, " ")}`, ref, url, at, key: `${ref}:${milestone}:${at}`, payload: { name, milestone } }); };
  for (const l of lines.filter((x) => x.specV && x.state !== "draft")) await milestoneMail(lineOrg[l.ref], l.ref, l.name, "finding_factory", l.no === 26 ? "2026-09-17" : l.req === "REQ-2026-0312" ? "2026-09-03" : "2026-09-15", `/app/lines/${l.ref}`);
  for (const o of offs) { for (const c of clientOf(lineOrg[o.line])) await q({ to: c, template: "client_offer_ready", subject: `Price ready — ${lines.find((l) => l.ref === o.line)!.name}`, ref: o.ref, url: `/app/offers/${o.ref}`, at: o.sent, key: o.ref }); }
  for (const s of smps) {
    await q({ to: "piotr", template: "client_sample_shipped", subject: `Your sample is on its way — ${lines.find((l) => l.ref === s.line)!.name}`, ref: s.ref, url: `/app/samples/${s.ref}`, at: s.shipped, key: s.ref, payload: { tracking: s.tracking, courier: "DHL" } });
    await q({ to: "piotr", template: "client_sample_ready", subject: "Sample received — please approve or reject", ref: s.ref, url: `/app/samples/${s.ref}`, at: s.received, key: s.ref });
  }
  await q({ to: "anna", template: "client_order_confirmed", subject: "Order confirmed — ORD-2026-0290", ref: "ORD-2026-0290", url: "/app/orders/ORD-2026-0290", at: "2026-06-15", key: "ORD-2026-0290" });
  await q({ to: "piotr", template: "client_order_confirmed", subject: "Order confirmed — ORD-2026-0312", ref: "ORD-2026-0312", url: "/app/orders/ORD-2026-0312", at: "2026-09-20", key: "ORD-2026-0312" });
  await q({ to: "anna", template: "client_payment_due", subject: "Payment due — deposit $2,256.00 + fee $300.00 for ORD-2026-0290", ref: "ORD-2026-0290", url: "/app/orders/ORD-2026-0290#payments", at: "2026-06-15", key: "ORD-2026-0290:deposit" });
  await q({ to: "anna", template: "client_payment_due", subject: "Payment due — balance $5,264.00 for ORD-2026-0290", ref: "ORD-2026-0290", url: "/app/orders/ORD-2026-0290#payments", at: "2026-07-08", key: "ORD-2026-0290:balance" });
  await q({ to: "piotr", template: "client_payment_due", subject: "Payment due — deposit $1,860.00 + fee $540.00 for ORD-2026-0312", ref: "ORD-2026-0312", url: "/app/orders/ORD-2026-0312#payments", at: "2026-09-20", key: "ORD-2026-0312:deposit" });
  await q({ to: "piotr", template: "client_artwork_requested", subject: "Artwork needed for ORD-2026-0312", ref: "ORD-2026-0312", url: "/app/orders/ORD-2026-0312#artwork", at: "2026-09-22", key: "ORD-2026-0312" });
  await q({ to: "bogdan", template: "ops_client_action", subject: "Piotr's team: artwork uploaded on ORD-2026-0312", ref: "ORD-2026-0312", url: "/ops/orders/ORD-2026-0312", at: "2026-09-22", key: "ORD-2026-0312:artwork" });
  await q({ to: "piotr", template: "client_artwork_approved", subject: "Artwork approved", ref: "ORD-2026-0312", url: "/app/orders/ORD-2026-0312#artwork", at: "2026-09-23", key: "ORD-2026-0312" });
  await milestoneMail(PIOTR.id, "ORD-2026-0312", "Standard sleeves 66×91 mm, 100 µm, PP, 100/bag", "in_production", "2026-09-23", "/app/orders/ORD-2026-0312");
  for (const [m, at] of [["in_production", "2026-06-20"], ["quality_check", "2026-07-06"], ["shipping", "2026-07-10"]] as const) await milestoneMail(KOFF.id, "ORD-2026-0290", "Boltless steel shelving 5-tier 180×90×40 black", m, at, "/app/orders/ORD-2026-0290");
  await q({ to: "anna", template: "client_qc_result", subject: "Quality check passed — ORD-2026-0290", ref: "ORD-2026-0290", url: "/app/orders/ORD-2026-0290#qc", at: "2026-07-08", key: "ORD-2026-0290" });
  await q({ to: "anna", template: "client_delivery_confirm", subject: "Delivered — please confirm ORD-2026-0290", ref: "ORD-2026-0290", url: "/app/orders/ORD-2026-0290", at: "2026-08-28", key: "ORD-2026-0290" });
  for (const [to, ref, at, name] of [["piotr", "REQ-2026-0312-01", "2026-09-23", "Standard sleeves 66×91 mm, 100 µm, PP, 100/bag"], ["piotr", "REQ-2026-0312-05", "2026-09-23", "Team bag 66×91"], ["anna", "REQ-2026-0301-01", "2026-09-26", "Work gloves red latex crinkle, size 10"], ["anna", "ORD-2026-0290", "2026-08-28", "Boltless steel shelving"]] as const) await q({ to, template: "client_new_update", subject: `Update on ${name}`, ref, url: ref.startsWith("ORD") ? `/app/orders/${ref}` : `/app/lines/${ref}`, at, key: `${ref}:${at}` });
  await q({ to: "piotr", template: "client_new_update", subject: "Update on Standard sleeves 66×91 mm, 100 µm, PP, 100/bag", ref: "FR-0001", url: "/app/orders/ORD-2026-0312/range", at: "2026-09-21", key: "FR-0001", payload: { text: "More from this factory is available" } });
  for (const [ref, at, action] of [["OFR-2026-0290-01-v1", "2026-06-15", "accepted option A"], ["OFR-2026-0312-01-v1", "2026-09-08", "accepted option A"], ["OFR-2026-0312-02-v1", "2026-09-19", "accepted option A"], ["SMP-2026-0312-01-1", "2026-09-19", "approved the sample"], ["ORD-2026-0312", "2026-09-22", "wired deposit + fee"]] as const) await q({ to: "bogdan", template: "ops_client_action", subject: `Client: ${action} on ${ref}`, ref, url: "/ops", at, key: `${ref}:${action}` });
  await q({ to: "bogdan", template: "ops_client_question", subject: "Question from Piotr's team on REQ-2026-0312-01", ref: "REQ-2026-0312-01", url: "/ops/lines/REQ-2026-0312-01?tab=timeline", at: "2026-09-24", key: "REQ-2026-0312-01:q1" });
  // mark everything sent at creation time + write the log
  const pending = await db.select().from(A.notificationOutbox).where(eq(A.notificationOutbox.status, "pending"));
  for (const row of pending) {
    await localSender.send(row);
    await db.update(A.notificationOutbox).set({ status: "sent", sentAt: row.createdAt, attempts: 1 }).where(eq(A.notificationOutbox.id, row.id));
  }

  /* sequences (SPEC 7.3) */
  await setSequence(db, "REQ", 326, 2026); await setSequence(db, "ORD", 326, 2026); await setSequence(db, "PRD", 16); await setSequence(db, "SUP", 18); await setSequence(db, "FACTORY_LABEL", 43); await setSequence(db, "FR", 2);

  /* fixtures (SPEC 7.14) */
  const fx = path.join(process.cwd(), "docs", "fixtures");
  mkdirSync(fx, { recursive: true });
  writeFileSync(path.join(fx, "leaky-report.pdf"), pdfBytes("QC report — Dongguan Yuantuo Packaging Products Co., Ltd. +86 138 0000 0042"));
  writeFileSync(path.join(fx, "clean-report.pdf"), pdfBytes("QC report — 0 critical, 2 minor, passed"));
  writeFileSync(path.join(fx, "leaky-range.pdf"), pdfBytes("Range — Qingdao Ecosino"));
  writeFileSync(path.join(fx, "clean-range.pdf"), pdfBytes("Range — shelving, racks, brackets"));
  writeFileSync(path.join(fx, "artwork.pdf"), pdfBytes("Artwork v1"));
  writeFileSync(path.join(fx, "sample-02.jpg"), await imageBytes("sample-02.jpg", "jpg"));
  writeFileSync(path.join(fx, "order312_sample.csv"), "Name,Link,Qty\n" + lines.filter((l) => l.req === "REQ-2026-0312").map((l) => `"${l.name}",,${l.qty}`).join("\n") + "\n");

  /* 7.16 consistency checks */
  const ctxs = await loadLineContexts(db, {});
  const piotrWaiting = waitingItems(ctxs.filter((c) => c.orgId === PIOTR.id)).map((w) => w.id);
  const koffWaiting = waitingItems(ctxs.filter((c) => c.orgId === KOFF.id)).map((w) => w.id);
  const stale = ctxs.filter((c) => c.stale).map((c) => c.ref).sort();
  const waitingClient = [...new Set(ctxs.filter((c) => c.waiting.party === "client").map((c) => c.order?.ref ?? c.ref))].sort();
  const unassigned = ctxs.filter((c) => c.state === "submitted" && !c.assignedAgentId).map((c) => c.ref);
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(`seed consistency check failed: ${msg}`); };
  assert(piotrWaiting.length === 1 && piotrWaiting[0] === "sample_received:REQ-2026-0312-02", `AC-DASH-01 piotr waiting = ${JSON.stringify(piotrWaiting)}`);
  assert(koffWaiting.length === 2 && koffWaiting.includes("offer_sent:REQ-2026-0301-01") && koffWaiting.includes("delivery_confirm:ORD-2026-0290"), `AC-DASH-02 koff waiting = ${JSON.stringify(koffWaiting)}`);
  assert(JSON.stringify(stale) === JSON.stringify(["REQ-2026-0312-14", "REQ-2026-0312-26", "REQ-2026-0318-01"]), `AC-OPS-01 stale = ${JSON.stringify(stale)}`);
  assert(JSON.stringify(waitingClient) === JSON.stringify(["ORD-2026-0290", "REQ-2026-0301-01", "REQ-2026-0312-02"]), `AC-OPS-02 waiting on client = ${JSON.stringify(waitingClient)}`);
  assert(JSON.stringify(unassigned) === JSON.stringify(["REQ-2026-0325-01"]), `AC-OPS-03 unassigned = ${JSON.stringify(unassigned)}`);
  const l11 = ctxs.find((c) => c.ref === "REQ-2026-0312-11")!;
  assert(l11.sourcing.reached === 3 && l11.sourcing.priced === 2, `AC-LINE-05 counts = ${JSON.stringify(l11.sourcing)}`);
  const l01 = ctxs.find((c) => c.ref === "REQ-2026-0312-01")!;
  assert(l01.sourcing.reached === 8 && l01.sourcing.priced === 6, `AC-BOARD-02 counts = ${JSON.stringify(l01.sourcing)}`);
  // ZZLEAKTEST: present internally, absent from every client-visible row
  const needle = "%ZZLEAKTEST%";
  const cvRes = await db.execute(sql`select
      (select count(*) from app.comments where visibility = 'client' and body ilike ${needle}) +
      (select count(*) from app.documents where visibility = 'client' and filename ilike ${needle}) +
      (select count(*) from app.activity_events where visibility = 'client' and payload::text ilike ${needle}) +
      (select count(*) from app.notification_outbox where template like 'client_%' and (payload::text ilike ${needle} or subject ilike ${needle})) as n`);
  const cvRows = ((cvRes as { rows?: { n: number }[] }).rows ?? (cvRes as unknown as { n: number }[]));
  const clientHits = Number(cvRows[0].n);
  const internalPlaces = [
    (await db.select().from(S.suppliers).where(eq(S.suppliers.ref, "SUP-0017"))).length,
    (await db.select().from(S.supplierContacts).where(eq(S.supplierContacts.handle, "zzleaktest_wx"))).length,
    (await db.select().from(S.supplierParticipations).where(eq(S.supplierParticipations.supplierId, SUP("SUP-0017")))).length,
    (await db.select().from(A.documents).where(eq(A.documents.filename, "ZZLEAKTEST-quote.xlsx"))).length,
    (await db.select().from(A.comments).where(sql`${A.comments.body} ilike ${needle}`)).length,
    (await db.select().from(A.activityEvents).where(sql`${A.activityEvents.payload}::text ilike ${needle}`)).length,
    (await db.select().from(S.supplierPriceLists).where(eq(S.supplierPriceLists.supplierId, SUP("SUP-0017")))).length,
  ].filter((n) => n > 0).length;
  assert(internalPlaces >= 6, `ZZLEAKTEST internal places = ${internalPlaces}`);
  assert(clientHits === 0, `ZZLEAKTEST leaked into ${clientHits} client-visible rows`);
  const sources = await loadLeakSources(db, { fresh: true });
  const clientComments = await db.select({ body: A.comments.body }).from(A.comments).where(eq(A.comments.visibility, "client"));
  for (const c of clientComments) { const r = leakCheck({ text: c.body }, sources); assert(r.ok, `client comment fails leak check: ${c.body} → ${JSON.stringify(!r.ok && r.hits)}`); }

  const outboxCount = (await db.select({ id: A.notificationOutbox.id }).from(A.notificationOutbox)).length;
  assert(outboxCount >= 40, `outbox rows = ${outboxCount}`);
  bump("_outbox_total", 0); summary["notification_outbox"] = outboxCount;

  /* summary */
  const ms = Date.now() - t0;
  console.log("\nInfluensia seed complete (clock 2026-09-28)\n" + "─".repeat(48));
  for (const [k, v] of Object.entries(summary).filter(([k]) => !k.startsWith("_")).sort()) console.log(`${k.padEnd(28)} ${String(v).padStart(6)}`);
  console.log("─".repeat(48));
  console.log(`checks: dashboards ✓ · stale ✓ · counts ✓ · ZZLEAKTEST canary in ${internalPlaces} internal places, 0 client rows ✓ · outbox ${outboxCount} sent → ${OUTBOX_LOG()}`);
  console.log(`logins (password ${PASSWORD}): ${users.map((u) => `${u.email} (${u.role})`).join(" · ")}`);
  console.log(`done in ${(ms / 1000).toFixed(1)} s`);
  void LINE_STATES; void mkLineRef; void mkOfferRef; void mkSampleRef; void orderRefFromRequest; void mkPoRef;
}

if (process.argv[1]?.endsWith("seed.ts")) seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
