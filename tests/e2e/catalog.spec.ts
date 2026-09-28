import { test, expect, type Page } from "@playwright/test";
import { resetDb } from "./helpers";

/**
 * F-11 catalog, F-12/F-25 ranges, F-21 suppliers, F-24 products — against the seed of SPEC §7.
 *  1. Piotr: /app/catalog lists the 4 published products with reference price, MOQ, incoterm+port, spec, valid-until (AC-CAT-01);
 *     the "More from your factories" section shows Factory F-0042 with 12 items; nothing supplier-shaped in the HTML.
 *  2. Piotr: /app/ranges/{id} shows the 12 items + PDF link; KOFF gets 404 for the same id (AC-RNG-02/04).
 *  3. Piotr: Request offer on PRD-0001 → new REQ, /app/requests (AC-CAT-03).
 *  4. Ops: 17 suppliers incl. the canary (AC-SUP-01); SUP-0007 contacts + range link (AC-SUP-02); 15 products, 4 in catalog (AC-PRD-01);
 *     agent's publish toggle disabled (AC-PRD-02); FR-0001 shows label + supplier + client + 12 items (AC-RNG-01).
 */
const PASSWORD = "Password123!";
const FORBIDDEN = /ZZLEAKTEST|Yuantuo|源拓|Suti|Yili|依立|Dr\. Card|Boyuan|Fuli|Jinou|Ecosino|SUP-00|PO-2026|FR-0001|daryl_yt|alibaba\.com|1688\.com/;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(app|ops)(\?|$)/);
}

test.beforeAll(resetDb); // each spec file starts from the freshly seeded snapshot

test("client catalog: 4 products with reference data, factory range section, no supplier leaks", async ({ page }) => {
  await login(page, "piotr@example.pl");
  await page.goto("/app/catalog");
  const cards = page.getByTestId("catalog-card");
  await expect(cards).toHaveCount(4);
  const shelving = page.locator("[data-testid=catalog-card][data-ref=PRD-0001]");
  await expect(shelving).toContainText("Boltless steel shelving 5-tier 180×90×40 black");
  await expect(shelving).toContainText("$8.90");
  await expect(shelving).toContainText("at 1,000 sets · FOB Qingdao · spec v2 · valid until 31 Dec 2026"); // unitLabel pluralises
  await expect(page.locator("[data-testid=catalog-card][data-ref=PRD-0002]")).toContainText("$0.26");
  await expect(page.locator("[data-testid=catalog-card][data-ref=PRD-0003]")).toContainText("$9.90");
  await expect(page.locator("[data-testid=catalog-card][data-ref=PRD-0004]")).toContainText("$0.062");
  await expect(shelving.locator("img")).toHaveAttribute("src", /\/api\/files\/org\/.+\/product\/.+\/client\//);
  // D-15 section
  const range = page.locator("[data-testid=range-card][data-label=F-0042]");
  await expect(range).toBeVisible();
  await expect(range).toContainText("Factory F-0042");
  await expect(range).toContainText("12 items");
  expect(await page.content()).not.toMatch(FORBIDDEN);
});

test("client range page: label, 12 items, PDF from a client key; other org gets 404", async ({ page, browser }) => {
  await login(page, "piotr@example.pl");
  await page.goto("/app/catalog");
  await page.locator("[data-testid=range-card][data-label=F-0042] a").click();
  await page.waitForURL(/\/app\/ranges\/[0-9a-f-]{36}$/);
  const url = page.url();
  await expect(page.getByTestId("range-items").getByTestId("range-item")).toHaveCount(12);
  await expect(page.getByTestId("factory-label").first()).toContainText("Factory F-0042");
  await expect(page.getByText("Deck box 100+")).toBeVisible();
  const pdf = page.getByTestId("range-pdf");
  await expect(pdf).toHaveAttribute("href", /\/api\/files\/org\/.+\/factory_range\/.+\/client\/.+\.pdf/);
  const res = await page.request.get((await pdf.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  expect(await page.content()).not.toMatch(FORBIDDEN);
  // select two items → the bar counts them
  await page.getByLabel("Select Deck box 100+").check();
  await page.getByLabel("Select Toploader 55pt").check();
  await expect(page.getByTestId("range-request-bar")).toContainText("2 items selected");
  // AC-RNG-04: KOFF buyer → 404 for Piotr's range
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, "buyer@koff.example");
  const r2 = await p2.goto(url);
  expect(r2?.status()).toBe(404);
  await ctx2.close();
});

test("client requests an offer from the catalog → new request in /app/requests (AC-CAT-03)", async ({ page }) => {
  await login(page, "piotr@example.pl");
  await page.goto("/app/catalog/PRD-0001");
  await expect(page.getByTestId("reference-block")).toContainText("$8.90");
  await expect(page.getByTestId("previous-orders")).toHaveCount(0); // Piotr never ordered it (AC-CAT-02)
  await page.locator("[data-testid=request-offer]:visible").first().click(); // header copy is lg:hidden, the aside one shows on desktop
  await page.fill("#qty", "500");
  await page.click("button[type=submit]:has-text('Send request')");
  await page.waitForURL(/\/app\/requests/);
  await expect(page.locator("[data-sonner-toast]").first()).toContainText(/Request REQ-2026-\d{4} sent/);
});

test("KOFF sees its previous order of PRD-0001 (AC-CAT-02)", async ({ page }) => {
  await login(page, "buyer@koff.example");
  await page.goto("/app/catalog/PRD-0001");
  const prev = page.getByTestId("previous-orders");
  await expect(prev).toContainText("ORD-2026-0290");
  await expect(prev).toContainText("$7.52");
  await expect(prev).toContainText("1,000 set");
  expect(await page.content()).not.toMatch(FORBIDDEN);
});

test("ops suppliers, products and ranges (AC-SUP-01/02, AC-PRD-01/02, AC-RNG-01)", async ({ page }) => {
  await login(page, "bogdan@influensia.ro");
  await page.goto("/ops/suppliers");
  await expect(page.getByTestId("suppliers-table").getByTestId("data-row")).toHaveCount(17);
  const canary = page.getByTestId("suppliers-table").getByTestId("data-row").filter({ hasText: "SUP-0017" });
  await expect(canary).toContainText("ZZLEAKTEST Co., Ltd.");
  await expect(canary).toContainText("Manufacturer");
  await expect(canary).toContainText("Dongguan");
  await expect(canary.locator("[data-grade=C]")).toBeVisible();
  await page.goto("/ops/suppliers/SUP-0007");
  await page.click("button[role=tab]:has-text('Contacts')");
  const contacts = page.getByTestId("contact-row");
  await expect(contacts).toHaveCount(2);
  await expect(contacts.nth(0)).toContainText("Daryl Yang");
  await expect(contacts.nth(0)).toContainText("daryl@yuantuo.example");
  await expect(contacts.nth(1)).toContainText("daryl_yt");
  await page.click("button[role=tab]:has-text('Participations')");
  await expect(page.getByTestId("participations").getByTestId("data-row")).toHaveCount(7);
  await expect(page.getByTestId("supplier-rail")).toContainText("Factory F-0042");
  await expect(page.getByTestId("supplier-rail")).toContainText("FR-0001");

  await page.goto("/ops/products");
  await expect(page.getByTestId("products-table").getByTestId("data-row")).toHaveCount(15);
  await expect(page.getByTestId("products-table").locator("[data-visibility=catalog]")).toHaveCount(4);
  await page.goto("/ops/products/PRD-0005");
  await expect(page.getByTestId("publish")).toBeDisabled();

  await page.goto("/ops/factory-ranges/FR-0001");
  await expect(page.getByTestId("factory-label").first()).toContainText("Factory F-0042");
  await expect(page.locator("h1")).toContainText("Dongguan Yuantuo Packaging Products Co., Ltd.");
  await expect(page.locator("header")).toContainText("Piotr's team");
  await expect(page.getByTestId("range-items-ops").getByTestId("range-item-ops")).toHaveCount(12);
  await expect(page.getByTestId("range-pdf-client")).toContainText("Factory-F-0042-range.pdf");
});

// last: it adds a participation to SUP-0007, which the ops test above counts
test("range request: Piotr requests an item → line starts in negotiating with the factory pre-selected (createRangeRequest)", async ({ page }) => {
  await login(page, "piotr@example.pl");
  await page.goto("/app/catalog");
  await page.locator("[data-testid=range-card][data-label=F-0042] a").click();
  await page.waitForURL(/\/app\/ranges\//);
  await page.getByLabel("Select Deck box 100+").check();
  await page.getByTestId("request-items").click();
  const toast = page.locator("[data-sonner-toast]").first();
  await expect(toast).toContainText(/Request REQ-2026-\d{4} sent — 1 item from Factory F-0042/);
  const reqRef = /REQ-2026-\d{4}/.exec((await toast.innerText()) ?? "")![0];
  expect(await page.content()).not.toMatch(FORBIDDEN);
  await page.goto("/logout");
  await login(page, "bogdan@influensia.ro");
  await page.goto(`/ops/lines/${reqRef}-01?tab=sourcing`);
  await expect(page.locator("[data-supplier='SUP-0007']")).toHaveAttribute("data-status", "selected");
  await expect(page.getByTestId("line-state")).toHaveAttribute("data-state", "negotiating");
});
