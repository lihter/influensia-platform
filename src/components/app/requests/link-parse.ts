/**
 * Pure paste-and-go helpers (SPEC F-04): URL parsing, tracking-param stripping, "not durable" flags and a readable title
 * derived from the URL host/path — no network. Used by the browser form (prefill) and by the server (authoritative).
 */

export type ParsedLink = { url: string; domain: string; notDurable: boolean; title: string };

const TRACKING = /^(utm_|srsltid$|fbclid$|gclid$|ck$|ckvia$|ref$|_ga$|mc_cid$|mc_eid$|spm$|share_source$|share_medium$)/i;
const NOT_DURABLE = [/(^|\.)share\.google(\.|$)/i, /(^|\.)vm\.tiktok\.com$/i, /(^|\.)vt\.tiktok\.com$/i, /(^|\.)facebook\.com$/i, /(^|\.)fb\.watch$/i, /(^|\.)a\.aliexpress\.com$/i, /(^|\.)m\.alibaba\.com$/i];
const STOP = new Set(["oferta", "produkt", "product", "products", "item", "items", "dp", "p", "www", "html", "htm", "detail", "product-detail", "offer", "pd", "listing", "listings", "i", "a", "the"]);

/** Splits pasted text on newlines / whitespace and keeps the http(s) URLs (≤ 2048 chars), deduplicated after cleaning. */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
    const t = raw.trim().replace(/^[<("'[]+|[>)"'\]]+$/g, "");
    if (!/^https?:\/\//i.test(t) || t.length > 2048) continue;
    const clean = cleanUrl(t);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

/** Strips tracking params (`utm_*`, `srsltid`, `fbclid`, `ck`, `ckvia`, …) and the hash; keeps everything else verbatim. */
export function cleanUrl(input: string): string | null {
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hash = "";
  let s = u.toString();
  if (s.endsWith("?")) s = s.slice(0, -1);
  return s;
}

export function isNotDurable(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname;
  if (NOT_DURABLE.some((re) => re.test(host))) return true;
  if (/(^|\.)alibaba\.com$/i.test(host) && (u.searchParams.get("from") === "share" || u.pathname === "/" || u.pathname === "")) return true;
  if (/(^|\.)facebook\.com$/i.test(host) && /\/share\//.test(u.pathname)) return true;
  return false;
}

export function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Readable title from the URL slug: last meaningful path segment, hyphens/underscores → spaces, numeric ids / uuids /
 * file extensions dropped, first letter capitalised. Falls back to the domain.
 */
export function titleFromUrl(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url.slice(0, 80); }
  if (isNotDurable(url)) return domainOf(url) || url.slice(0, 80); // share links carry an opaque id, not a slug
  const segments = u.pathname.split("/").map((s) => { try { return decodeURIComponent(s); } catch { return s; } }).filter(Boolean);
  const candidates = segments
    .map((s) => s.replace(/\.(html?|php|aspx?)$/i, "").replace(UUID_ANY, "").replace(/[-_]?\d{6,}$/g, ""))
    .filter((s) => !STOP.has(s.toLowerCase()) && !/^\d+$/.test(s) && !UUID.test(s))
    .map((s) => slugToWords(s))
    .filter((w) => w.length >= 3);
  // prefer the longest human-looking segment (most letters)
  const best = candidates.sort((a, b) => letters(b) - letters(a))[0];
  if (best && letters(best) >= 3) return cap(best).slice(0, 200);
  const q = u.searchParams.get("q") ?? u.searchParams.get("keyword") ?? u.searchParams.get("SearchText");
  if (q && q.trim().length >= 2) return cap(q.trim()).slice(0, 200);
  return domainOf(url) || url.slice(0, 80);
}

function slugToWords(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((w) => w && !UUID.test(w) && !(/^\d{6,}$/.test(w)) && !/^[0-9a-f]{8,}$/i.test(w) && !/^(?=.*\d)[A-Z0-9]{8,}$/.test(w))
    .join(" ")
    .trim();
}
const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseLink(url: string): ParsedLink | null {
  const clean = cleanUrl(url);
  if (!clean) return null;
  return { url: clean, domain: domainOf(clean), notDurable: isNotDurable(clean), title: titleFromUrl(clean) };
}

/** Name for a photo line: the file name without extension, underscores/hyphens → spaces. */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").trim();
  return cap(base || "Photo").slice(0, 200);
}
