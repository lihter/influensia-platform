import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { resetDb } from "./helpers";

/**
 * Intake + lists + queue (SPEC F-04, F-05, F-06, F-14). Runs against the freshly seeded dir of playwright.config.ts
 * (or E2E_PORT / its own data dir). Serial: the "send" test creates REQ-2026-0326 which the queue tests then claim/assign.
 */
const PASSWORD = "Password123!";
const FIXTURES = path.resolve(__dirname, "../../docs/fixtures");

async function login(page: Page, email: string) {
  await page.goto("/logout").catch(() => {});
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(app|ops)(\?|$)/);
}

async function paste(page: Page, text: string) {
  await page.getByTestId("paste-area").click();
  await page.evaluate((t) => {
    const el = document.querySelector("[data-testid=paste-area]")!;
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

test.beforeAll(resetDb); // each spec file starts from the freshly seeded snapshot

test.describe.configure({ mode: "serial" });

test("AC-LIST-01/02/03/04 — Requests & orders tabs, search, 390 px", async ({ page, browser }) => {
  await login(page, "piotr@example.pl");
  await page.goto("/app/requests");
  const rows = page.getByTestId("list-row");
  await expect(rows).toHaveCount(8);
  const line01 = page.locator("[data-ref='REQ-2026-0312-01']");
  await expect(line01).toContainText("ORD-2026-0312");
  await expect(line01.locator("[data-milestone=in_production]")).toBeVisible();
  await page.goto("/app/requests?tab=drafts");
  await expect(page.getByTestId("empty-state")).toContainText("No drafts");
  const html = await page.content();
  expect(html).not.toMatch(/ZZLEAKTEST|Yuantuo|Suti|Yili|依立|Dr\. Card|Boyuan|Fuli|Jinou|SUP-00|PO-2026/);

  await login(page, "buyer@koff.example");
  await page.goto("/app/requests?tab=delivered");
  await expect(page.getByTestId("list-row")).toHaveCount(1);
  await expect(page.getByTestId("list-row").first()).toContainText("ORD-2026-0290");
  await expect(page.getByTestId("list-row").first().locator("[data-milestone=delivered]")).toBeVisible();
  await page.goto("/app/requests");
  await page.getByTestId("list-search").fill("gloves");
  await expect(page.getByTestId("list-row")).toHaveCount(1);
  await expect(page.getByTestId("list-row").first()).toContainText("Work gloves");
  await page.goto("/app/requests?tab=drafts");
  await expect(page.getByTestId("list-row")).toHaveCount(1);
  await expect(page.getByTestId("list-row").first()).toContainText("camping chair");

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await ctx.newPage();
  await login(phone, "buyer@koff.example");
  await phone.goto("/app/requests");
  await expect(phone.getByTestId("list-row").first()).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await ctx.close();
});

test("AC-NEW-01/02/03/04 — paste links, quantity errors, send, outbox + queue", async ({ page }) => {
  await login(page, "piotr@example.pl");
  await page.goto("/app/requests/new");
  await paste(page, [
    "https://allegro.pl/oferta/rekawiczki-rekawice-robocze-r10-latex-12539547048?srsltid=AfmBOoq123",
    "https://allegro.pl/oferta/sople-500-led-24m-15866789012",
    "https://allegro.pl/oferta/lampki-choinkowe-100-led-17866789012",
  ].join("\n"));
  await expect(page.getByTestId("line-row")).toHaveCount(3);
  await expect(page.getByTestId("line-name").first()).toHaveValue("Rekawiczki rekawice robocze r10 latex");
  // AC-NEW-02: no quantities → "Enter a quantity" on each row, nothing created
  await page.getByTestId("send-request").click();
  await expect(page.getByTestId("qty-error")).toHaveCount(3);
  await expect(page).toHaveURL(/\/app\/requests\/new$/);
  // two valid rows + a photo row (EXIF is stripped server-side: files.exif_stripped)
  await page.getByTestId("remove-line").nth(2).click();
  await page.getByTestId("photo-input").setInputFiles(path.join(FIXTURES, "sample-02.jpg"));
  await expect(page.getByTestId("line-row")).toHaveCount(3);
  const qty = page.getByTestId("line-qty");
  await qty.nth(0).fill("10000");
  await qty.nth(1).fill("500");
  await qty.nth(2).fill("300");
  await page.getByTestId("send-request").click();
  await page.waitForURL(/\/app\/requests\/REQ-2026-0326\?sent=1/);
  await expect(page.getByTestId("sent-confirmation")).toContainText("REQ-2026-0326");
  await expect(page.getByTestId("request-line")).toHaveCount(3);
  // AC-NEW-01: tracking param not stored
  const hrefs = await page.getByTestId("line-link").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(hrefs[0]).toBe("https://allegro.pl/oferta/rekawiczki-rekawice-robocze-r10-latex-12539547048");
  // Documents tab lists the reference image
  await page.getByRole("tab", { name: /Documents/ }).click();
  await expect(page.getByTestId("document-row")).toHaveCount(1);
  // AC-NEW-03: /ops/queue lists the new lines as unassigned; outbox rows
  await login(page, "bogdan@influensia.ro");
  await page.goto("/ops/queue?scope=unassigned");
  await expect(page.locator("[data-testid=data-row]", { hasText: "REQ-2026-0326-01" })).toBeVisible();
  await expect(page.locator("[data-testid=data-row]", { hasText: "REQ-2026-0326-03" }).getByTestId("claim")).toBeVisible();
  const drained = await page.request.get("/api/cron/outbox").then((r) => r.json());
  expect(drained.sent).toBeGreaterThanOrEqual(4); // 1 client_request_received + 3 ops_new_request
});

test("AC-QUEUE-01/02 — queue row, assign to Bogdan, timeline events; claim; bulk assign", async ({ page }) => {
  await login(page, "cristina@influensia.ro");
  await page.goto("/ops/queue");
  const row = page.locator("[data-testid=data-row]", { hasText: "REQ-2026-0325-01" });
  await expect(row).toContainText("Portal");
  await expect(row.getByTestId("links-cell")).toContainText("1");
  await expect(row).toContainText("—");
  await row.getByTestId("assign").click();
  await page.getByTestId("assign-bogdan").click();
  await expect(row).toContainText("Bogdan");
  await expect(row.locator("[data-state=in_review]")).toBeVisible();
  await page.goto("/ops/requests/REQ-2026-0325");
  await page.getByRole("tab", { name: /Activity/ }).click();
  const tl = page.getByTestId("timeline");
  await expect(tl).toContainText("Your contact is Bogdan");
  await expect(tl).toContainText("In review");
  // claim
  await login(page, "bogdan@influensia.ro");
  await page.goto("/ops/queue?scope=unassigned");
  const before = await page.getByTestId("data-row").count();
  await page.getByTestId("claim").first().click();
  await expect(page.getByTestId("data-row")).toHaveCount(before - 1);
  // bulk assign the rest to Cristina
  await page.getByTestId("select-row").first().check();
  await page.getByTestId("bulk-assign").click();
  await page.getByTestId("assign-cristina").click();
  await expect(page.getByTestId("bulk-bar")).toHaveCount(0);
});

test("AC-QUEUE-03 — requests list filtered by client shows the REQ-2026-0312 roll-up", async ({ page }) => {
  await login(page, "bogdan@influensia.ro");
  await page.goto("/ops/requests");
  await page.getByTestId("filter-client").selectOption({ label: "Piotr's team" });
  const r312 = page.locator("[data-testid=data-row]", { hasText: "REQ-2026-0312" });
  await expect(r312).toContainText("8");
  const rollup = await r312.getByTestId("state-rollup").evaluate((el) => [...el.querySelectorAll("[data-rollup-state]")].map((x) => `${(x as HTMLElement).dataset.rollupState} ${(x as HTMLElement).dataset.count}`).join(" · "));
  expect(rollup).toBe("in_production 1 · sampling 1 · negotiating 1 · quotes_in 3 · rfq_out 1 · spec_frozen 1");
  await r312.click();
  await page.waitForURL(/\/ops\/requests\/REQ-2026-0312/);
  await expect(page.getByTestId("request-lines-table").getByTestId("data-row")).toHaveCount(8);
  await expect(page.getByTestId("client-note")).toContainText("form reference");
});

test("AC-NEW-05/06/07 — xlsx/csv import, fallback attach, save draft (not in queue)", async ({ page }) => {
  await login(page, "piotr@example.pl");
  await page.goto("/app/requests/new");
  await page.getByTestId("tab-import").click();
  await page.getByTestId("import-input").setInputFiles(path.join(FIXTURES, "order312_sample.csv"));
  await expect(page.getByTestId("import-done")).toBeVisible();
  await expect(page.getByTestId("line-row")).toHaveCount(8);
  const qtys = await page.getByTestId("line-qty").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(qtys).toEqual(["100000", "100000", "50000", "50000", "20000", "5000", "5000", "2000"]);
  // AC-NEW-06: a file without recognisable headers → fallback → attach as a document + one line named after it
  await page.getByTestId("import-input").setInputFiles({ name: "weird.csv", mimeType: "text/csv", buffer: Buffer.from("a,b,c\n1,2,3\n") });
  await expect(page.getByTestId("import-fallback")).toContainText("We couldn't read this file");
  await page.getByTestId("import-attach").click();
  await expect(page.getByTestId("line-row")).toHaveCount(9);
  await expect(page.getByTestId("line-name").nth(8)).toHaveValue("Weird");
  // AC-NEW-07: save draft
  await page.getByTestId("save-draft").click();
  await page.waitForURL(/\/app\/requests\/REQ-2026-0327$/);
  await expect(page.getByTestId("send-draft")).toBeVisible();
  // drafts have no Updates/History tabs; the attached file is listed in a Documents section
  await expect(page.getByTestId("draft-documents").getByTestId("document-row")).toHaveCount(1);
  await expect(page.getByTestId("draft-documents")).toContainText("weird.csv");
  await page.goto("/app/requests?tab=drafts");
  await expect(page.getByTestId("list-row")).toHaveCount(9);
  await login(page, "bogdan@influensia.ro");
  await page.goto("/ops/queue");
  await expect(page.locator("[data-testid=data-row]", { hasText: "REQ-2026-0327" })).toHaveCount(0);
  const drained = await page.request.get("/api/cron/outbox").then((r) => r.json());
  expect(drained.sent).toBe(0);
});

test("AC-NEW-08 — agent creates a request on behalf of KOFF; visible to the KOFF buyer; no client email unless ticked", async ({ page }) => {
  await login(page, "bogdan@influensia.ro");
  await page.goto("/ops/requests/new");
  await page.getByTestId("org-picker").click();
  await page.getByRole("option", { name: /KOFF/ }).click();
  await page.getByTestId("whatsapp-note").fill("Anna: 2000 szt. lampek, link poniżej");
  await paste(page, "https://allegro.pl/oferta/lampki-choinkowe-100-led-cieply-bialy-12345678901\n");
  await expect(page.getByTestId("line-row")).toHaveCount(1);
  await page.getByTestId("line-qty").first().fill("2000");
  await page.getByTestId("send-request").click();
  await page.waitForURL(/\/ops\/requests\/REQ-2026-0328/);
  await expect(page.locator("[data-source]", { hasText: "WhatsApp" }).first()).toBeVisible(); // FIX-C: plain source label with icon, not a badge
  await expect(page.getByTestId("timeline")).toContainText("2000 szt.");
  const drained = await page.request.get("/api/cron/outbox").then((r) => r.json());
  expect(drained.sent).toBe(3); // ops_new_request × 3, no client_request_received
  await login(page, "buyer@koff.example");
  await page.goto("/app/products");
  await expect(page.locator("[data-testid=product-row][data-ref='REQ-2026-0328-01']")).toBeVisible();
  await page.goto("/app/requests/REQ-2026-0328");
  await expect(page.getByTestId("request-line")).toHaveCount(1);
  const html = await page.content();
  expect(html).not.toContain("Anna: 2000");
});
