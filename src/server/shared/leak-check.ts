/**
 * Anonymity mechanism 6 (SPEC B.5). Pure function — no db here; `loadLeakSources()` is separate (and cached) so tests
 * need no database. Runs on: document publish (filename + text layer), offer send (all text fields), client updates/answers,
 * on-hold reason, product publish, range publish, sample-photo filenames, and as the last gate in the email sender.
 *
 * What it catches (QA-01 hardening, fix phase):
 * - supplier legal / CN names, with the company suffix stripped, and their SHORT forms: the city/province prefix and the
 *   industry words are dropped ("Dongguan Yuantuo Packaging Products Co., Ltd." → "Yuantuo"; "东莞市源拓包装制品有限公司"
 *   → 源拓包装制品 / 源拓包装 / 源拓), also hyphen/space-split ("Yuan-tuo");
 * - every contact handle, phone (digits) and full contact name, plus every token of a contact name (≥ 3 chars) that is
 *   not a common English word (so "Daryl", "Wang" fire but "time" never fires for "Tim" — word boundaries everywhere);
 * - CJK personal-name patterns: 李小姐 / 王先生 / 张总 / 陈经理 / 老王, and "Mr Wang" / "Ms Li";
 * - supplier cities/provinces when the text is about the factory ("Linyi factory", "our factory in Dongguan"); loading-port
 *   cities (Shenzhen, Ningbo, …) only when they sit right next to a factory word, so "shipped via Shenzhen" stays clean.
 *   Callers whose text is inherently about the factory (the offer builder) pass `factoryContext: true`.
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
  /** suppliers.city + province (non-deleted); the built-in list of Chinese manufacturing cities is always added */
  cities?: string[];
};

export type LeakKind = "supplier_name" | "handle" | "phone_cn" | "contact_name" | "uscc" | "url" | "wechat" | "company_suffix" | "ref" | "city";
export type LeakHit = { kind: LeakKind; match: string; where: string; index?: number };
export type LeakResult = { ok: true } | { ok: false; hits: LeakHit[] };
export type LeakInput = {
  text?: string | null;
  filenames?: string[];
  pdfText?: string | null;
  fields?: Record<string, string | null | undefined>;
  /** the text is about the factory by construction (offer fields, range items) — city names always count */
  factoryContext?: boolean;
};

export class LeakCheckError extends Error {
  code = "E_LEAK_CHECK" as const;
  status = 422;
  constructor(public hits: LeakHit[]) {
    super(`E_LEAK_CHECK: ${hits.map((h) => `${h.kind} '${h.match}' in ${h.where}`).join("; ")}`);
  }
}

/* ────────── static word lists ────────── */

/** Chinese loading ports: allowed on their own (FOB Shenzhen, via Ningbo). */
export const LOADING_PORTS = ["Shenzhen", "Ningbo", "Shanghai", "Qingdao", "Xiamen", "Tianjin", "Guangzhou"] as const;
const PORT_ALIASES: Record<string, string> = {
  shenzhen: "Shenzhen", "深圳": "Shenzhen", yantian: "Shenzhen", shekou: "Shenzhen", sz: "Shenzhen",
  ningbo: "Ningbo", "宁波": "Ningbo", "ningbo-zhoushan": "Ningbo", "ningbo zhoushan": "Ningbo",
  shanghai: "Shanghai", "上海": "Shanghai",
  qingdao: "Qingdao", "青岛": "Qingdao",
  xiamen: "Xiamen", "厦门": "Xiamen",
  tianjin: "Tianjin", "天津": "Tianjin", xingang: "Tianjin",
  guangzhou: "Guangzhou", "广州": "Guangzhou", nansha: "Guangzhou", huangpu: "Guangzhou",
};
const PORT_WORDS = new Set([...Object.keys(PORT_ALIASES), "hong kong", "hongkong", "香港", "dalian", "大连", "lianyungang", "连云港"]);

/** "Shenzhen 深圳" / "SHENZHEN port" / "FOB Ningbo" → canonical loading port, or null for inland cities ("Linyi"). */
export function normaliseLoadingPort(raw: string | null | undefined): (typeof LOADING_PORTS)[number] | null {
  if (!raw) return null;
  const s = raw.normalize("NFKC").toLowerCase().replace(/\b(fob|exw|cif|cfr|port|of|china|cn)\b/g, " ").replace(/[,.;:()]/g, " ").trim();
  for (const [alias, port] of Object.entries(PORT_ALIASES)) {
    if (/^[a-z -]+$/.test(alias) ? new RegExp(`(^|\\s)${alias}(\\s|$)`).test(s) : s.includes(alias)) return port as (typeof LOADING_PORTS)[number];
  }
  return null;
}

/** Chinese manufacturing cities/provinces (EN + CJK). Always part of the city list; supplier.city/province are added. */
const BUILTIN_CITIES = [
  "dongguan", "shenzhen", "guangzhou", "ningbo", "yiwu", "qingdao", "shanghai", "xiamen", "tianjin", "huizhou", "wenzhou", "zhongshan",
  "nantong", "linyi", "jinan", "taizhou", "dongyang", "jinhua", "foshan", "suzhou", "hangzhou", "shantou", "quanzhou", "fuzhou", "jiangmen",
  "jieyang", "chaozhou", "yongkang", "wuyi", "cixi", "yuyao", "shaoxing", "jiaxing", "huzhou", "changzhou", "wuxi", "yangzhou", "xuzhou",
  "dingzhou", "dezhou", "ningjin", "baoding", "bazhou", "langfang", "shijiazhuang", "cangzhou", "zibo", "weifang", "yantai", "weihai", "rizhao",
  "guangdong", "zhejiang", "jiangsu", "shandong", "fujian", "hebei", "anhui", "henan", "hubei", "hunan", "jiangxi", "sichuan",
  "东莞", "深圳", "广州", "宁波", "义乌", "青岛", "上海", "厦门", "天津", "惠州", "温州", "中山", "南通", "临沂", "济南", "台州", "东阳", "金华",
  "佛山", "苏州", "杭州", "汕头", "泉州", "福州", "江门", "揭阳", "潮州", "永康", "武义", "慈溪", "余姚", "绍兴", "嘉兴", "湖州", "常州", "无锡",
  "扬州", "徐州", "定州", "德州", "宁津", "保定", "霸州", "廊坊", "石家庄", "沧州", "淄博", "潍坊", "烟台", "威海", "日照",
  "广东", "浙江", "江苏", "山东", "福建", "河北", "安徽", "河南", "湖北", "湖南", "江西", "四川",
];

/** Words that make a sentence "about the factory" (city names only count in such a sentence). */
const FACTORY_WORDS = "factory|factories|supplier|suppliers|manufacturer|manufacturers|maker|makers|workshop|workshops|plant|mill|producer|producers|vendor|vendors";
const FACTORY_WORD_RE = new RegExp(`\\b(?:${FACTORY_WORDS})\\b|工厂|厂家|供应商|生产商|制造商`, "i");

/** Industry / legal words dropped when deriving a supplier's short name (EN). */
const INDUSTRY_WORDS = new Set([
  "packaging", "package", "trading", "trade", "industrial", "industry", "industries", "technology", "technologies", "tech", "limited", "company", "products", "product",
  "international", "intl", "import", "export", "imp", "exp", "hardware", "plastic", "plastics", "manufacturing", "manufacturer", "manufactory", "factory", "crafts", "craft",
  "safety", "lighting", "light", "lights", "culture", "metal", "metals", "steel", "structure", "structures", "garden", "unidentified", "verify", "legal", "name", "quote", "unknown",
  "sunshine", "stylish", "china", "co", "ltd", "inc", "corp", "corporation", "group", "holdings", "holding", "enterprise", "enterprises", "development", "science", "new", "material",
  "materials", "electronic", "electronics", "electric", "electrical", "appliance", "appliances", "sports", "sport", "fitness", "outdoor", "outdoors", "household", "home", "daily",
  "necessities", "gift", "gifts", "toys", "toy", "textile", "textiles", "garment", "garments", "furniture", "printing", "paper", "rubber", "glove", "gloves", "tree", "trees",
  "christmas", "decoration", "decorations", "art", "arts", "machinery", "machine", "equipment", "supply", "supplies", "commodity", "commodities", "commercial", "business",
  "card", "cards", "dr", "and", "the", "of", "a", "d",
]);

/** Industry words dropped from the end of a CN short name (longest first; applied repeatedly). */
const CN_INDUSTRY = [
  "有限责任公司", "股份有限公司", "有限公司", "公司", "劳保用品", "体育用品", "日用品", "包装材料", "新材料", "钢结构", "工艺品", "进出口", "圣诞树",
  "用品", "制品", "包装", "工艺", "塑胶", "塑料", "五金", "实业", "贸易", "商贸", "工贸", "科技", "电子", "照明", "灯饰", "文化", "金属", "结构", "家具", "纺织",
  "国际", "电器", "印刷", "纸品", "橡胶", "圣诞", "户外", "发展", "集团", "制造", "工业", "机械", "服饰", "手套", "健身", "器材", "运动", "材料", "生物", "光电",
  "礼品", "玩具", "饰品", "劳保", "钢", "厂",
];

/** Common English words (≥ 3 letters) that must never fire as contact-name tokens or short names. */
const STOPWORDS = new Set(`
the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use
about above after again against also always another around because been before being below between both came come could does doing down during each even every
first from further give given good great have having here into just know last like little long look made make many more most much must never next only other over
own part people place right same should since some still such take than that their them then there these they thing think this those through time under until upon
very want well went were what when where which while will with within without work would year your yours best better big bring call case check come cost dear done
end ever fact far few find fine free full gave hand help high hold home hope idea keep kind late less line live mean mind move name near need note open plan play
real rest run seem show side sign small soon start stay step stop sure talk tell test top true turn wait walk week went wide word yes yet
sun sunday monday tuesday wednesday thursday friday saturday january february march april may june july august september october november december
morning evening today tomorrow yesterday tonight night noon hour hours minute minutes
leak leaks leaking tester test tests testing sample samples sales sale manager boss team office service support contact info admin dept department export import
order orders price prices quote quotes quality color colour colours colors size sizes pack packs bag bags box boxes carton cartons film sheet sleeve sleeves card cards
deck binder holder toploader shelf shelving shed sheds tree trees light lights glove gloves mat mats chair chairs lamp lamps pump pumps
star stars king queen rose grace hope joy faith dawn summer spring autumn winter sunny sky rain snow wind river lake sea ocean golden gold silver bright
mark bill pat sue max ray art amber crystal jade ruby pearl holly iris ivy may will jack
mr mrs ms miss sir madam dear hello thanks thank regards best kind
`.split(/\s+/).filter(Boolean));

/** Pinyin surnames for "Mr Wang" / "Ms Li" style mentions. */
const PINYIN_SURNAMES = "wang|li|zhang|liu|chen|yang|huang|zhao|wu|zhou|xu|sun|ma|zhu|hu|guo|he|lin|luo|zheng|liang|xie|song|tang|han|feng|deng|cao|peng|zeng|xiao|tian|dong|yuan|pan|jiang|cai|yu|du|ye|cheng|su|wei|lv|lu|ding|ren|shen|yao|cui|zhong|tan|wang|fan|jin|shi|liao|jia|xia|fu|fang|bai|zou|meng|xiong|qin|qiu|yin|xue|yan|duan|lei|hou|long|shi|tao|li|he|gu|mao|hao|gong|shao|wan|qian|dai|mo|kong|xiang";
/** Common Chinese surnames (CJK) for 李小姐 / 王先生 / 张总 / 老王. */
const CJK_SURNAMES = "李王张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤";

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
  // personal names: 李小姐 / 王先生 / 张总 / 陈经理 / 刘女士 / 老王, "Mr Wang", "Ms. Li"
  { kind: "contact_name", re: new RegExp(`[${CJK_SURNAMES}](?:小姐|先生|女士|总|经理|老板|姐|哥)|老[${CJK_SURNAMES}]`, "g") },
  { kind: "contact_name", re: new RegExp(`\\b(?:Mr|Mrs|Ms|Miss|Mister|Madam)\\.?\\s+(?:${PINYIN_SURNAMES})\\b`, "gi") },
];

/** Literal exemptions (SPEC B.5 §5): the anonymised label. */
const EXEMPT = /\bFactory F-\d{4}\b/gi;

function decodeCopies(s: string): string[] {
  const out = [s];
  try { const d = decodeURIComponent(s); if (d !== s) out.push(d); } catch { /* ignore */ }
  const ent = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  if (ent !== s) out.push(ent);
  return out;
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s.,\-_'"()（）·•—–/\\:;!?|[\]{}<>@#&+*=~`^]+/g, " ").trim();
const digits = (s: string) => s.replace(/\D/g, "");
const isCjkChar = (s: string) => /[一-鿿]/.test(s);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** word-bounded match on a normalised (space-separated) string */
const hasWord = (hay: string, needle: string) => new RegExp(`(^|\\s)${escapeRe(needle)}(\\s|$)`).test(hay);

/** Strips company suffixes and punctuation (SPEC B.5 §1). */
export function stripCompanySuffix(name: string): string {
  return norm(name)
    .replace(/\b(co\.?,?\s?ltd\.?|company limited|limited|inc\.?|corp\.?|factory|manufactory)\s*$/i, "")
    .replace(/(有限公司|有限责任公司|股份有限公司|厂)\s*$/, "")
    .trim();
}

const CITY_SET = new Set(BUILTIN_CITIES);

/** CN short forms: 东莞市源拓包装制品有限公司 → [东莞市源拓包装制品, 源拓包装制品, 源拓包装, 源拓]. */
export function cnShortNames(cn: string): string[] {
  const out = new Set<string>();
  for (const run of cn.normalize("NFKC").match(/[一-鿿]+/g) ?? []) {
    const s = run.replace(/(有限责任公司|股份有限公司|有限公司|公司|厂)$/, "");
    if (s.length >= 3) out.add(s);
    // drop "XX省" / "XX市" / "XX区|县" prefixes and bare known city names at the front
    let core = s.replace(/^[一-鿿]{2,3}省/, "").replace(/^[一-鿿]{2,4}?市/, "").replace(/^[一-鿿]{2,3}?[区县]/, "");
    for (let guard = 0; guard < 3; guard++) { const c = BUILTIN_CITIES.find((x) => isCjkChar(x) && core.startsWith(x) && core.length > x.length + 1); if (!c) break; core = core.slice(c.length); }
    if (core.length >= 2) out.add(core);
    for (let guard = 0; guard < 6; guard++) {
      const w = CN_INDUSTRY.find((x) => core.endsWith(x) && core.length - x.length >= 2);
      if (!w) break;
      core = core.slice(0, -w.length);
      out.add(core);
    }
  }
  return [...out].filter((x) => x.length >= 2);
}

/** EN short forms: "Dongguan Yuantuo Packaging Products Co., Ltd." → { phrase: "yuantuo", tokens: ["yuantuo"] }. */
export function enShortNames(legal: string): { phrases: string[]; tokens: string[] } {
  const words = stripCompanySuffix(legal).split(" ").filter((w) => /^[a-z0-9]+$/.test(w));
  let i = 0;
  while (i < words.length - 1 && CITY_SET.has(words[i])) i++;
  let j = words.length;
  while (j > i + 1 && INDUSTRY_WORDS.has(words[j - 1])) j--;
  const core = words.slice(i, j);
  const tokens = core.filter((w) => w.length >= 4 && !INDUSTRY_WORDS.has(w) && !STOPWORDS.has(w) && !CITY_SET.has(w) && /[a-z]/.test(w));
  // multi-word brand phrases after the city prefix ("sunshine garden", "dr card", "mali tree") — adjacency required
  const afterCity = words.slice(i);
  const phrases: string[] = [];
  for (let k = 2; k <= afterCity.length; k++) { const p = afterCity.slice(0, k).join(" "); if (p.length >= 6) phrases.push(p); }
  return { phrases, tokens };
}

/** Tokens of a contact name that identify a person: every word ≥ 3 chars not in the stopword list; CJK runs ≥ 2. */
export function contactTokens(name: string): string[] {
  const n = norm(name.replace(/[（(][^)）]*[)）]/g, (m) => ` ${m} `));
  const out = new Set<string>();
  for (const w of n.split(" ")) {
    if (!w) continue;
    for (const run of w.match(/[一-鿿]+/g) ?? []) if (run.length >= 2) out.add(run);
    const latin = w.replace(/[一-鿿]+/g, "");
    if (latin.length >= 3 && /^[a-z]+$/.test(latin) && !STOPWORDS.has(latin)) out.add(latin);
  }
  return [...out];
}

type Compiled = {
  names: { match: string; full: string; stripped: string; phrases: string[]; tokens: string[]; cn: string[]; spaceless: string[] }[];
  handles: string[];
  phones: string[];
  contacts: { match: string; full: string; tokens: string[] }[];
  usccs: string[];
  cities: { match: string; key: string; isPort: boolean; cjk: boolean }[];
};
const compiledCache = new WeakMap<LeakSources, Compiled>();

function compile(sources: LeakSources): Compiled {
  const hit = compiledCache.get(sources);
  if (hit) return hit;
  const names = sources.names.filter(Boolean).map((name) => {
    const cjk = isCjkChar(name);
    const en = enShortNames(name);
    return {
      match: name, full: norm(name), stripped: stripCompanySuffix(name), phrases: en.phrases, tokens: en.tokens,
      cn: cjk ? cnShortNames(name) : [], spaceless: en.tokens.filter((t) => t.length >= 6),
    };
  });
  const contacts = (sources.contactNames ?? []).filter(Boolean).map((c) => ({ match: c, full: norm(c), tokens: contactTokens(c) }));
  const cityNames = new Set<string>([...BUILTIN_CITIES, ...(sources.cities ?? []).filter(Boolean).flatMap((c) => [norm(c).replace(/\s*(city|province|shi|sheng)$/, "").replace(/[市省]$/, "")])]);
  const cities = [...cityNames].filter((c) => c.length >= 2).map((c) => ({ match: c, key: c, isPort: PORT_WORDS.has(c), cjk: isCjkChar(c) }));
  const value: Compiled = {
    names, contacts, cities,
    handles: sources.handles.filter(Boolean).map(norm),
    phones: (sources.phones ?? []).map(digits).filter((p) => p.length >= 8),
    usccs: (sources.usccs ?? []).filter((u) => u && u.length >= 8).map(norm),
  };
  compiledCache.set(sources, value);
  return value;
}

export function leakCheck(input: LeakInput, sources: LeakSources): LeakResult {
  const c = compile(sources);
  const hits: LeakHit[] = [];
  const scan = (raw: string, where: string, forceContext: boolean) => {
    if (!raw) return;
    for (const copy of decodeCopies(raw)) {
      const exempted = copy.replace(EXEMPT, " ");
      const n = norm(exempted);
      const flat = n.replace(/\s+/g, "");
      const nd = digits(exempted);
      for (const s of c.names) {
        if (s.full.length >= 4 && n.includes(s.full)) { hits.push({ kind: "supplier_name", match: s.match, where, index: n.indexOf(s.full) }); continue; }
        const minLen = isCjkChar(s.stripped) ? 3 : 6;
        if (s.stripped.length >= minLen && (isCjkChar(s.stripped) ? n.includes(s.stripped) : hasWord(n, s.stripped))) { hits.push({ kind: "supplier_name", match: s.match, where, index: n.indexOf(s.stripped) }); continue; }
        for (const p of s.phrases) if (hasWord(n, p)) hits.push({ kind: "supplier_name", match: p, where, index: n.indexOf(p) });
        for (const t of s.tokens) if (hasWord(n, t)) hits.push({ kind: "supplier_name", match: t, where, index: n.indexOf(t) });
        for (const t of s.spaceless) if (!hasWord(n, t) && flat.includes(t)) hits.push({ kind: "supplier_name", match: t, where });
        for (const cn of s.cn) if (n.includes(cn)) { hits.push({ kind: "supplier_name", match: cn, where, index: n.indexOf(cn) }); break; }
      }
      for (const h of c.handles) if (h.length >= 5 && n.includes(h)) hits.push({ kind: "handle", match: h, where, index: n.indexOf(h) });
      for (const p of c.phones) if (nd.includes(p)) hits.push({ kind: "phone_cn", match: p, where });
      for (const ct of c.contacts) {
        if (ct.full.length >= 4 && (isCjkChar(ct.full) ? n.includes(ct.full) : hasWord(n, ct.full))) { hits.push({ kind: "contact_name", match: ct.match, where, index: n.indexOf(ct.full) }); continue; }
        for (const t of ct.tokens) if (isCjkChar(t) ? n.includes(t) : hasWord(n, t)) hits.push({ kind: "contact_name", match: t, where, index: n.indexOf(t) });
      }
      for (const u of c.usccs) if (n.includes(u)) hits.push({ kind: "uscc", match: u, where });
      // cities: only in a factory context; ports only right next to a factory word
      const context = forceContext || FACTORY_WORD_RE.test(exempted);
      if (context) {
        for (const city of c.cities) {
          const present = city.cjk ? n.includes(city.key) : hasWord(n, city.key);
          if (!present) continue;
          if (!city.isPort) { hits.push({ kind: "city", match: city.match, where, index: n.indexOf(city.key) }); continue; }
          if (city.cjk) { if (new RegExp(`${city.key}.{0,4}(?:工厂|厂家|厂)`).test(n)) hits.push({ kind: "city", match: city.match, where }); continue; }
          const k = escapeRe(city.key);
          const near = new RegExp(`\\b(?:${FACTORY_WORDS})\\s+(?:is\\s+|are\\s+|was\\s+)?(?:in|at|from|near|based in|located in|outside)\\s+${k}\\b|\\b${k}(?:\\s+based)?\\s+(?:${FACTORY_WORDS})\\b|\\b(?:made|produced|manufactured|built)\\s+in\\s+${k}\\b`, "i");
          if (near.test(n)) hits.push({ kind: "city", match: city.match, where });
        }
      }
      for (const { kind, re } of PATTERNS) {
        re.lastIndex = 0;
        for (const m of exempted.matchAll(re)) hits.push({ kind, match: m[0].trim(), where, index: m.index });
      }
    }
  };
  const force = !!input.factoryContext;
  if (input.text) scan(input.text, "text", force);
  if (input.pdfText) scan(input.pdfText, "pdf_text", force);
  for (const f of input.filenames ?? []) scan(f, "filename", force);
  for (const [field, v] of Object.entries(input.fields ?? {})) if (v) scan(v, field, force);
  const dedup = [...new Map(hits.map((h) => [`${h.kind}|${h.match.toLowerCase()}|${h.where}`, h])).values()];
  return dedup.length ? { ok: false, hits: dedup } : { ok: true };
}

/** Throws LeakCheckError (→ 422 / `E_LEAK_CHECK`) on any hit. */
export function assertClean(input: LeakInput, sources: LeakSources): void {
  const r = leakCheck(input, sources);
  if (!r.ok) throw new LeakCheckError(r.hits);
}

/* ────────── db loader (cached 60 s) ────────── */
let cache: { at: number; value: LeakSources } | null = null;

export async function loadLeakSources(db: DbOrTx, opts?: { fresh?: boolean }): Promise<LeakSources> {
  if (!opts?.fresh && cache && Date.now() - cache.at < 60_000) return cache.value;
  const s = await db.select({ legalName: suppliers.legalName, cnName: suppliers.cnName, uscc: suppliers.uscc, city: suppliers.city, province: suppliers.province }).from(suppliers).where(isNull(suppliers.deletedAt));
  const c = await db.select({ name: supplierContacts.name, handle: supplierContacts.handle, phone: supplierContacts.phone }).from(supplierContacts).where(isNull(supplierContacts.deletedAt));
  const value: LeakSources = {
    names: s.flatMap((r) => [r.legalName, r.cnName]).filter((x): x is string => !!x),
    handles: c.map((r) => r.handle).filter((x): x is string => !!x),
    phones: c.map((r) => r.phone).filter((x): x is string => !!x),
    contactNames: c.map((r) => r.name).filter((x): x is string => !!x),
    usccs: s.map((r) => r.uscc).filter((x): x is string => !!x),
    cities: s.flatMap((r) => [r.city, r.province]).filter((x): x is string => !!x),
  };
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateLeakSources() { cache = null; }
