/**
 * Anonymity mechanism 6 (SPEC B.5). Pure function — no db here; `loadLeakSources()` is separate (and cached) so tests
 * need no database. Runs on: document publish (filename + text layer), offer send (all text fields), client updates/answers,
 * on-hold reason, product publish, range publish, sample-photo filenames, and as the last gate in the email sender.
 */
import type { DbOrTx } from "@/db";
import { isNull } from "drizzle-orm";
import { suppliers, supplierContacts } from "@/db/schema/supplier";

export type LeakSources = {
  /** suppliers.legal_name + cn_name (non-deleted) */
  names: string[];
  /** supplier_contacts.handle */
  handles: string[];
  /** supplier_contacts.phone (any format; digits are extracted) */
  phones?: string[];
  /** supplier_contacts.name */
  contactNames?: string[];
  /** suppliers.uscc */
  usccs?: string[];
};

export type LeakKind = "supplier_name" | "handle" | "phone_cn" | "contact_name" | "uscc" | "url" | "wechat" | "company_suffix" | "ref";
export type LeakHit = { kind: LeakKind; match: string; where: string; index?: number };
export type LeakResult = { ok: true } | { ok: false; hits: LeakHit[] };

export class LeakCheckError extends Error {
  code = "E_LEAK_CHECK" as const;
  status = 422;
  constructor(public hits: LeakHit[]) {
    super(`E_LEAK_CHECK: ${hits.map((h) => `${h.kind} '${h.match}' in ${h.where}`).join("; ")}`);
  }
}

const PATTERNS: { kind: LeakKind; re: RegExp }[] = [
  { kind: "url", re: /\b(?:[a-z0-9-]+\.)*(?:alibaba|1688|aliexpress|made-in-china|globalsources|whatsapp)\.(?:com|cn)\b[^\s"'<>]*/gi },
  { kind: "wechat", re: /(?:\bwechat\b|\bweixin\b|微信)/gi },
  // CN mobile: optional +86 / 0086, then 1[3-9] and 9 more digits with optional separators
  { kind: "phone_cn", re: /(?:(?:\+|00)?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}\b/g },
  { kind: "company_suffix", re: /\b[A-Z][A-Za-z0-9&.'()\- ]{1,60}?\s(?:Co\.?,?\s?Ltd\.?|Company\s+Limited|Corp\.?|Manufactory|Industrial\s+Co\.?)\b/g },
  { kind: "company_suffix", re: /\bCo\.?,?\s?Ltd\b/gi },
  { kind: "company_suffix", re: /[一-鿿]{2,}(?:有限公司|有限责任公司|股份有限公司|厂)/g },
  { kind: "ref", re: /\bSUP-\d{4}\b/g },
  { kind: "ref", re: /\bPO-\d{4}-\d{4}(?:-\d{2})?\b/g },
  { kind: "ref", re: /\bFR-\d{4}\b/g },
];

/** Literal exemptions (SPEC B.5 §5): the anonymised label, the bare word, China, port names. */
const EXEMPT = /\bFactory F-\d{4}\b/gi;

const GENERIC = new Set([
  "dongguan", "shenzhen", "guangzhou", "ningbo", "yiwu", "qingdao", "shanghai", "xiamen", "tianjin", "huizhou", "wenzhou", "zhongshan",
  "nantong", "linyi", "jinan", "taizhou", "dongyang", "guangdong", "shandong", "zhejiang", "jiangsu", "fujian",
  "packaging", "trading", "industrial", "industry", "technology", "limited", "company", "products", "product", "international",
  "import", "export", "hardware", "plastic", "plastics", "manufacturing", "manufacturer", "factory", "crafts", "safety", "lighting",
  "culture", "metal", "steel", "structure", "garden", "unidentified", "verify", "legal", "quote", "unknown", "sunshine", "stylish",
  "structure", "china",
]);

const FIRST_NAMES = new Set([
  "john", "cathy", "lily", "sam", "tim", "david", "sarah", "daryl", "benson", "vicky", "yulia", "tom", "jack", "lucy", "amy", "anna",
  "jenny", "jessica", "kevin", "peter", "alice", "sunny", "cindy", "jason", "michael", "grace", "linda", "emma", "eric", "helen",
  "jerry", "james", "mary", "nancy", "ivy", "coco", "wendy", "vivian", "leo", "max", "andy", "tony", "mike", "steven", "kelly",
  "小姐", "先生", "经理",
]);

function decodeCopies(s: string): string[] {
  const out = [s];
  try { const d = decodeURIComponent(s); if (d !== s) out.push(d); } catch { /* ignore */ }
  const ent = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  if (ent !== s) out.push(ent);
  return out;
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s.,\-_'"()（）·•]+/g, " ").trim();
const digits = (s: string) => s.replace(/\D/g, "");
const isCjk = (s: string) => /^[一-鿿\s]+$/.test(s);

/** Strips company suffixes and punctuation (SPEC B.5 §1). */
export function stripCompanySuffix(name: string): string {
  return norm(name)
    .replace(/\b(co\.?,?\s?ltd\.?|company limited|limited|inc\.?|corp\.?|factory|manufactory)\s*$/i, "")
    .replace(/(有限公司|有限责任公司|股份有限公司|厂)\s*$/, "")
    .trim();
}

export function leakCheck(
  input: { text?: string | null; filenames?: string[]; pdfText?: string | null; fields?: Record<string, string | null | undefined> },
  sources: LeakSources,
): LeakResult {
  const hits: LeakHit[] = [];
  const scan = (raw: string, where: string) => {
    if (!raw) return;
    for (const copy of decodeCopies(raw)) {
      const exempted = copy.replace(EXEMPT, " ");
      const n = norm(exempted);
      const nd = digits(exempted);
      for (const name of sources.names) {
        const nn = norm(name);
        const stripped = stripCompanySuffix(name);
        const minLen = isCjk(stripped) ? 3 : 6;
        if (nn.length >= 4 && n.includes(nn)) { hits.push({ kind: "supplier_name", match: name, where, index: n.indexOf(nn) }); continue; }
        if (stripped.length >= minLen && n.includes(stripped)) { hits.push({ kind: "supplier_name", match: name, where, index: n.indexOf(stripped) }); continue; }
        for (const tok of stripped.split(" ")) {
          if (tok.length >= 6 && !GENERIC.has(tok) && new RegExp(`\\b${tok}\\b`).test(n)) hits.push({ kind: "supplier_name", match: tok, where, index: n.indexOf(tok) });
        }
      }
      for (const h of sources.handles) {
        const nh = norm(h);
        if (nh.length >= 5 && n.includes(nh)) hits.push({ kind: "handle", match: h, where, index: n.indexOf(nh) });
      }
      for (const p of sources.phones ?? []) {
        const pd = digits(p);
        if (pd.length >= 8 && nd.includes(pd)) hits.push({ kind: "phone_cn", match: p, where });
      }
      for (const c of sources.contactNames ?? []) {
        const nc = norm(c);
        if (nc.length >= 4 && !FIRST_NAMES.has(nc) && new RegExp(`(^|\\s)${nc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(n)) hits.push({ kind: "contact_name", match: c, where, index: n.indexOf(nc) });
      }
      for (const u of sources.usccs ?? []) {
        if (u && u.length >= 8 && n.includes(norm(u))) hits.push({ kind: "uscc", match: u, where });
      }
      for (const { kind, re } of PATTERNS) {
        re.lastIndex = 0;
        for (const m of exempted.matchAll(re)) hits.push({ kind, match: m[0].trim(), where, index: m.index });
      }
    }
  };
  if (input.text) scan(input.text, "text");
  if (input.pdfText) scan(input.pdfText, "pdf_text");
  for (const f of input.filenames ?? []) scan(f, "filename");
  for (const [field, v] of Object.entries(input.fields ?? {})) if (v) scan(v, field);
  const dedup = [...new Map(hits.map((h) => [`${h.kind}|${h.match.toLowerCase()}|${h.where}`, h])).values()];
  return dedup.length ? { ok: false, hits: dedup } : { ok: true };
}

/** Throws LeakCheckError (→ 422 / `E_LEAK_CHECK`) on any hit. */
export function assertClean(input: Parameters<typeof leakCheck>[0], sources: LeakSources): void {
  const r = leakCheck(input, sources);
  if (!r.ok) throw new LeakCheckError(r.hits);
}

/* ────────── db loader (cached 60 s) ────────── */
let cache: { at: number; value: LeakSources } | null = null;

export async function loadLeakSources(db: DbOrTx, opts?: { fresh?: boolean }): Promise<LeakSources> {
  if (!opts?.fresh && cache && Date.now() - cache.at < 60_000) return cache.value;
  const s = await db.select({ legalName: suppliers.legalName, cnName: suppliers.cnName, uscc: suppliers.uscc }).from(suppliers).where(isNull(suppliers.deletedAt));
  const c = await db.select({ name: supplierContacts.name, handle: supplierContacts.handle, phone: supplierContacts.phone }).from(supplierContacts).where(isNull(supplierContacts.deletedAt));
  const value: LeakSources = {
    names: s.flatMap((r) => [r.legalName, r.cnName]).filter((x): x is string => !!x),
    handles: c.map((r) => r.handle).filter((x): x is string => !!x),
    phones: c.map((r) => r.phone).filter((x): x is string => !!x),
    contactNames: c.map((r) => r.name).filter((x): x is string => !!x),
    usccs: s.map((r) => r.uscc).filter((x): x is string => !!x),
  };
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateLeakSources() { cache = null; }
