import { test, expect, type Page } from "@playwright/test";
import { login, resetDb } from "./helpers";

/**
 * Anonymity crawl (SPEC 5.4, @critical). For each client user: breadth-first crawl of every /app page reachable from the
 * nav — dashboard, list tabs, every request / line / offer / sample / order / catalog product / factory range, settings —
 * and every client document / image link found on them. Each page's raw response (incl. the RSC payload) and rendered
 * DOM must contain none of the supplier needles. Then the same needles are asserted to be PRESENT on the equivalent
 * /ops pages, so the crawl cannot pass vacuously.
 */
test.beforeAll(resetDb);
test.describe.configure({ mode: "serial" });

const NEEDLES: Array<[string, RegExp]> = [
  ["ZZLEAKTEST", /zzleaktest/i],
  ["ZZ泄漏测试", /ZZ泄漏测试/],
  ["Yuantuo", /yuantuo/i],
  ["Suti", /\bsuti\b/i],
  ["Daryl", /\bdaryl/i],
  ["+86", /\+86/],
  ["Co., Ltd", /co\.,?\s*ltd/i],
  ["有限公司", /有限公司/],
  ["alibaba.com", /alibaba\.com/i],
  ["1688.com", /1688\.com/i],
  ["wechat", /wechat|weixin|微信/i],
  ["SUP- ref", /\bSUP-\d{4}\b/],
  ["PO ref", /\bPO-2026-/],
];

/**
 * Client-authored content that legitimately matches a generic pattern: KOFF's own draft REQ-2026-0322-01 carries the
 * alibaba.com reference link the buyer pasted (SPEC §7 seed). Showing a client its own link is not a supplier leak.
 * Exempted precisely: the raw href, and the readable "alibaba.com › ultralight-camping-chair_…" label the smart-paste
 * link chips render for it (client-format.ts `shortLink`, truncated at 40 chars) — nothing else on alibaba.com.
 */
const CLIENT_AUTHORED = [
  /(?:www\.)?alibaba\.com(?:\/|%2F|\\\/)product-detail(?:\/|%2F|\\\/)ultralight-cam[\w.-]*/gi, // display text is truncated
  /alibaba\.com\s*(?:›|\\u203a|&#8250;|&#x203a;|&rsaquo;)\s*ultralight-camping-chair_[\w.-]*(?:…|\\u2026|&#8230;|&hellip;)?/gi, // shortLink() label
];

/** Hits in `text`, also after URL- and HTML-entity-decoding (SPEC 5.4 "also URL-encoded and HTML-entity-encoded"). */
function hits(input: string): string[] {
  const text = CLIENT_AUTHORED.reduce((t, re) => t.replace(re, "[client-link]"), input);
  let decoded = text;
  try { decoded = decodeURIComponent(text.replace(/%(?![0-9a-f]{2})/gi, "%25")); } catch { /* keep raw */ }
  const entities = text.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
  return NEEDLES.flatMap(([name, re]) => {
    for (const t of [text, decoded, entities]) {
      const m = re.exec(t);
      if (m) return [`${name} («…${t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 30).replace(/\s+/g, " ")}…»)`];
    }
    return [];
  });
}
const names = (found: string[]) => found.map((f) => f.split(" («")[0]);

const SKIP = /^\/(logout|login)|^\/api\/(auth|cron|test)/;

async function crawl(page: Page, start: string[], max = 160) {
  const queue = [...start];
  const seen = new Set<string>(queue);
  const visited: string[] = [];
  const assets = new Set<string>();
  const failures: string[] = [];
  const enqueue = (u: string) => { if (!seen.has(u)) { seen.add(u); queue.push(u); } };
  while (queue.length && visited.length < max) {
    const url = queue.shift()!;
    const res = await page.goto(url);
    visited.push(url);
    if (!res || res.status() !== 200) { failures.push(`${url} → HTTP ${res?.status()}`); continue; }
    const raw = await res.text();
    const dom = await page.content();
    const found = [...new Set([...hits(raw), ...hits(dom)])];
    if (found.length) failures.push(`${url} leaks ${found.join(", ")}`);
    const links = await page.$$eval("a[href], img[src]", (els) => els.map((e) => e.getAttribute("href") ?? e.getAttribute("src") ?? ""));
    for (const href of links) {
      if (!href.startsWith("/")) continue;
      const clean = href.split("#")[0];
      if (clean.startsWith("/api/files/")) { assets.add(clean); continue; }
      if (!clean.startsWith("/app") || SKIP.test(clean)) continue;
      enqueue(clean);
    }
    // SPEC 2.2 instantiated per entity: every line's request page too (lists link to lines, not requests)
    const line = /^\/app\/lines\/(REQ-\d{4}-\d{4})-\d{2}$/.exec(url);
    if (line) enqueue(`/app/requests/${line[1]}`);
  }
  // every client document / image link on those pages: served (200) and clean
  for (const a of assets) {
    const r = await page.request.get(a);
    if (r.status() !== 200) { failures.push(`${a} → HTTP ${r.status()}`); continue; }
    const body = (await r.body()).toString("latin1");
    const found = hits(body);
    if (found.length) failures.push(`${a} leaks ${found.join(", ")}`);
  }
  return { visited, assets: [...assets], failures, unvisited: queue.length };
}

const NAV = ["/app", "/app/requests", "/app/requests?tab=waiting", "/app/requests?tab=delivered", "/app/requests?tab=drafts", "/app/catalog", "/app/settings"];
/** Every seeded line of the org (SPEC 5.4 "instantiated for every seeded entity") — ordered lines link to their order, not the line page. */
const SEEDED: Record<string, string[]> = {
  "piotr@example.pl": ["01", "02", "03", "05", "11", "14", "20", "26"].map((n) => `/app/lines/REQ-2026-0312-${n}`),
  "buyer@koff.example": ["0290-01", "0301-01", "0305-01", "0318-01", "0321-01", "0321-02", "0321-03", "0325-01"].map((n) => `/app/lines/REQ-2026-${n}`).concat("/app/requests/REQ-2026-0322"),
};

for (const who of ["piotr@example.pl", "buyer@koff.example"]) {
  test(`@critical anonymity crawl — ${who}`, async ({ page }) => {
    test.setTimeout(900_000);
    await login(page, who);
    const r = await crawl(page, [...NAV, ...SEEDED[who]]);
    console.log(`[anonymity] ${who}: ${r.visited.length} pages, ${r.assets.length} files\n  ${r.visited.join("\n  ")}`);
    expect(r.failures, r.failures.join("\n")).toEqual([]);
    expect(r.unvisited, "crawl budget exhausted — raise max").toBe(0);
    // coverage: the crawl really reached every kind of detail page this client has
    const kinds = (p: string) => r.visited.some((u) => u.startsWith(p));
    for (const p of ["/app/requests/REQ-", "/app/lines/REQ-", "/app/orders/ORD-", "/app/catalog/PRD-"]) expect(kinds(p), `no ${p}… page reached`).toBe(true);
    if (who === "piotr@example.pl") {
      for (const p of ["/app/samples/SMP-", "/app/ranges/"]) expect(kinds(p), `no ${p}… page reached`).toBe(true);
      expect(r.visited).toContain("/app/lines/REQ-2026-0312-01");
      expect(r.visited).toContain("/app/orders/ORD-2026-0312");
    } else {
      expect(kinds("/app/offers/OFR-"), "no offer page reached").toBe(true);
      expect(r.visited).toContain("/app/orders/ORD-2026-0290");
    }
    expect(r.assets.length).toBeGreaterThan(0);
  });
}

test("@critical cross-org refs are 404", async ({ page }) => {
  await login(page, "piotr@example.pl");
  for (const u of ["/app/lines/REQ-2026-0301-01", "/app/orders/ORD-2026-0290", "/app/requests/REQ-2026-0301", "/app/offers/OFR-2026-0301-01-v1"]) {
    expect((await page.goto(u))?.status(), u).toBe(404);
  }
  await page.goto("/logout");
  await login(page, "buyer@koff.example");
  for (const u of ["/app/lines/REQ-2026-0312-01", "/app/orders/ORD-2026-0312", "/app/requests/REQ-2026-0312", "/app/samples/SMP-2026-0312-02-1", "/app/orders/ORD-2026-0312/range"]) {
    expect((await page.goto(u))?.status(), u).toBe(404);
  }
});

test("@critical non-vacuity: the needles ARE on the equivalent /ops pages", async ({ page }) => {
  await login(page, "bogdan@influensia.ro");
  const seenOn = new Map<string, string>();
  for (const u of ["/ops/lines/REQ-2026-0312-01?tab=sourcing", "/ops/lines/REQ-2026-0312-01?tab=timeline", "/ops/orders/ORD-2026-0312", "/ops/suppliers/SUP-0017", "/ops/suppliers/SUP-0007"]) {
    const res = await page.goto(u);
    expect(res?.status(), u).toBe(200);
    const html = `${await res!.text()}\n${await page.content()}`;
    for (const name of names(hits(html))) if (!seenOn.has(name)) seenOn.set(name, u);
  }
  // the canary and the named supplier/contact/phone/legal-form/platform needles are all reachable for ops
  for (const n of ["ZZLEAKTEST", "Yuantuo", "Daryl", "+86", "Co., Ltd", "有限公司", "SUP- ref", "PO ref"]) expect(seenOn.has(n), `${n} not found on any /ops page`).toBe(true);
  await expect(page.locator("body")).toBeVisible();
});
