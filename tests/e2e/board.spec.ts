import { test, expect, type Page } from "@playwright/test";
import { resetDb } from "./helpers";

/**
 * Line page + sourcing board + offers + samples (SPEC F-07, F-08, F-09, F-15…F-20). Runs against the freshly seeded
 * PGlite dir from playwright.config.ts. Ops flows first (they mutate line 0312-03), then the client decisions.
 */
const PASSWORD = "Password123!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(app|ops)(\?|$)/);
}

test.beforeAll(resetDb); // each spec file starts from the freshly seeded snapshot
test.describe.configure({ mode: "serial" }); // the client block decides on the offer the ops block sends

test.describe.serial("ops line page", () => {
  test("AC-BOARD-01/02: the seeded card-sleeves board + compare strip", async ({ page }) => {
    await login(page, "bogdan@influensia.ro");
    await page.goto("/ops/lines/REQ-2026-0312-01?tab=sourcing");
    await expect(page.getByTestId("board-row")).toHaveCount(9);
    const strip = page.getByTestId("compare-strip");
    await expect(strip).toContainText("$0.0539");
    await expect(strip).toContainText("Yuantuo");
    await expect(strip).toContainText("$0.0320");
    await expect(strip).toContainText("excluded: dropped, expired");
    await expect(strip).toContainText("2.4×");
    await expect(strip).toContainText("6 quotes of 8 contacted");
    await expect(strip).toContainText("2 stale");
    await expect(page.locator("[data-supplier='SUP-0017']")).toContainText("ZZLEAKTEST"); // canary present on ops (SPEC 5.4 step 5)
    await expect(page.locator("[data-supplier='SUP-0007'] [data-testid=usd-cell]")).toContainText("$0.0539");
    await expect(page.locator("[data-supplier='SUP-0013'] [data-testid=last-cell]")).toContainText("15 d");
  });

  test("AC-BOARD-03: log a quote for Boyuan → quoted, USD/unit 0.0460, 7 of 8, 1 stale", async ({ page }) => {
    await login(page, "bogdan@influensia.ro");
    await page.goto("/ops/lines/REQ-2026-0312-01?tab=sourcing");
    await page.locator("[data-supplier='SUP-0012'] [data-testid=row-menu]").click();
    await page.getByTestId("row-log-quote").click();
    await page.getByTestId("quote-port").fill("Shenzhen");
    await page.getByTestId("quote-moq").fill("50000");
    await page.getByTestId("quote-valid").fill("2026-10-31");
    await page.getByTestId("break-qty").first().fill("50000");
    await page.getByTestId("break-price").first().fill("0.049");
    await page.getByTestId("add-break").click();
    await page.getByTestId("break-qty").nth(1).fill("100000");
    await page.getByTestId("break-price").nth(1).fill("0.046");
    await expect(page.getByTestId("normalised-preview")).toContainText("$0.0460");
    await page.getByRole("button", { name: "Log quote" }).last().click();
    await expect(page.locator("[data-supplier='SUP-0012']")).toHaveAttribute("data-status", "quoted");
    await expect(page.locator("[data-supplier='SUP-0012'] [data-testid=usd-cell]")).toContainText("$0.0460");
    await expect(page.getByTestId("compare-strip")).toContainText("7 quotes of 8 contacted");
    await expect(page.getByTestId("compare-strip")).toContainText("1 stale");
  });

  test("AC-BOARD-05: shortlist without a reason is rejected; with one it is saved", async ({ page }) => {
    await login(page, "bogdan@influensia.ro");
    await page.goto("/ops/lines/REQ-2026-0312-01?tab=sourcing");
    await page.locator("[data-supplier='SUP-0008'] [data-testid=status-trigger]").click();
    await page.getByTestId("status-shortlisted").click();
    await page.getByTestId("status-confirm").click();
    await expect(page.getByTestId("status-dialog")).toContainText("Reason required");
    await page.getByTestId("status-reason").fill("cheapest, verify micron on sample");
    await page.getByTestId("status-confirm").click();
    await expect(page.locator("[data-supplier='SUP-0008']")).toHaveAttribute("data-status", "shortlisted");
  });

  test("AC-OFB-02/03/04: build an offer on line 03, leak-check block, then send", async ({ page }) => {
    await login(page, "bogdan@influensia.ro");
    await page.goto("/ops/lines/REQ-2026-0312-03?tab=offer");
    const suti = page.locator("[data-testid=source-check][data-supplier='SUP-0008']");
    if (!(await suti.isChecked())) await suti.check();
    await expect(page.getByTestId("option-card")).toHaveCount(2);
    await expect(page.locator("[data-testid=option-card][data-label=A] [data-testid=ladder-price]").first()).toHaveValue(/0\.0598/);
    await page.locator("[data-testid=option-card][data-label=A] [data-testid=deviations]").fill("none");
    await page.locator("[data-testid=option-card][data-label=B] [data-testid=deviations]").fill("Quoted by Yiwu Suti Crafts");
    await page.getByTestId("send-offer").click();
    await expect(page.getByTestId("offer-error")).toContainText(/Leak check.*Suti/);
    await page.locator("[data-testid=option-card][data-label=B] [data-testid=deviations]").fill("80/100 µm film, verify on sample");
    await page.getByTestId("send-offer").click();
    await expect(page.locator("[data-testid=sent-offers] [data-status=sent]")).toHaveCount(1);
    await page.goto("/ops/lines/REQ-2026-0312-03?tab=timeline");
    await expect(page.getByTestId("line-state")).toHaveAttribute("data-state", "offer_ready");
  });

  test("AC-TL-03/02: client update leak-blocked, then posted", async ({ page }) => {
    await login(page, "bogdan@influensia.ro");
    await page.goto("/ops/lines/REQ-2026-0312-01?tab=timeline");
    await page.getByTestId("mode-update").click();
    await page.getByTestId("composer-body").fill("as Yuantuo confirmed, production starts Monday");
    await page.getByTestId("composer-post").click();
    await expect(page.getByTestId("composer-error")).toContainText(/Leak check.*Yuantuo/i, { timeout: 45_000 });
    await page.getByTestId("composer-body").fill("Production photos from the line");
    await page.getByTestId("composer-post").click();
    await expect(page.getByTestId("timeline")).toContainText("Production photos from the line");
    await expect(page.getByTestId("timeline")).toContainText("Daryl (Yuantuo)"); // AC-TL-01 WhatsApp log present
    await expect(page.getByTestId("timeline")).toContainText("Suti registered 2026-03");
  });
});

test.describe.serial("client pages", () => {
  test("AC-LINE-01/03: line 01 stepper, facts, documents, order card; no supplier leaks", async ({ page }) => {
    await login(page, "piotr@example.pl");
    await page.goto("/app/lines/REQ-2026-0312-01");
    await expect(page.locator("[data-testid=stepper] li[aria-current=step]")).toContainText("In production");
    await expect(page.getByTestId("facts-strip")).toContainText("100,000");
    await expect(page.getByTestId("facts-strip")).toContainText("$0.062");
    await expect(page.getByTestId("facts-strip")).toContainText("+ fee");
    await expect(page.getByTestId("facts-strip")).toContainText("18 Nov 2026");
    await expect(page.getByTestId("order-card")).toHaveAttribute("href", "/app/orders/ORD-2026-0312");
    await page.getByTestId("tab-documents").click();
    const docs = page.getByTestId("documents");
    for (const n of ["allegro-sleeves-ref.jpg", "PI-ORD-2026-0312.pdf", "Artwork-sleeves-v1.pdf", "Dieline-sleeve-66x91.pdf", "Sample-photo-1.jpg", "Sample-photo-2.jpg"]) await expect(docs).toContainText(n);
    const html = await page.content();
    expect(html).not.toMatch(/ZZLEAKTEST|Yuantuo|Suti|Yili|依立|Dr\. Card|Boyuan|Fuli|Jinou|SUP-00|PO-2026|Quote D/);
    expect(html).not.toMatch(/Yuantuo-quote|ZZLEAKTEST-quote|Best-prices|PO-2026-0312-01\.pdf|RFQ-0312/);
  });

  test("AC-LINE-05/09: sourcing progress text; other org → 404", async ({ page }) => {
    await login(page, "piotr@example.pl");
    await page.goto("/app/lines/REQ-2026-0312-11");
    await expect(page.getByTestId("sub-label")).toContainText("3 contacted · 2 quoted");
    const res = await page.goto("/app/lines/REQ-2026-0301-01");
    expect(res?.status()).toBe(404);
  });

  test("AC-LINE-07: Ask about this order → appears in Updates", async ({ page }) => {
    await login(page, "piotr@example.pl");
    await page.goto("/app/lines/REQ-2026-0312-01?tab=ask");
    await page.getByTestId("ask-text").fill("Can you share production photos?");
    await page.getByTestId("ask-send").click();
    await expect(page.getByTestId("ask-form")).toContainText("Sent");
    await page.goto("/app/lines/REQ-2026-0312-01");
    await expect(page.getByTestId("updates")).toContainText("Can you share production photos?");
  });

  test("AC-OFFER-04/02: fresh offer on line 03 — ask for changes; KOFF accepts gloves offer", async ({ page }) => {
    await login(page, "piotr@example.pl");
    await page.goto("/app/offers/OFR-2026-0312-03-v1");
    await expect(page.getByTestId("option-card")).toHaveCount(2);
    expect(await page.content()).not.toMatch(/Yuantuo|Suti/);
    await page.getByTestId("ask-changes").click();
    await page.getByTestId("changes-text").fill("Need 120 µm");
    await page.getByTestId("changes-send").click();
    await page.waitForURL(/\/app\/lines\/REQ-2026-0312-03/);
    await expect(page.getByTestId("client-line")).toContainText("Change requested");
    await page.goto("/logout");
    await login(page, "buyer@koff.example");
    await page.goto("/app/offers/OFR-2026-0301-01-v1");
    await expect(page.getByTestId("option-price")).toContainText("$0.26");
    await expect(page.getByTestId("option-card")).toContainText("10,000 pair");
    expect(await page.content()).not.toMatch(/Tongfu|Linyi/);
    await page.getByTestId("accept-A").click();
    await page.getByTestId("accept-confirm").click();
    await page.waitForURL(/\/app\/lines\/REQ-2026-0301-01/);
    await expect(page.getByTestId("client-line")).toHaveAttribute("data-state", "offer_accepted");
  });

  test("AC-SMP-01/02: approve the received sample on line 02", async ({ page }) => {
    await login(page, "piotr@example.pl");
    await page.goto("/app/samples/SMP-2026-0312-02-1");
    await expect(page.getByTestId("sample-tracking")).toContainText("JD014600012345678901");
    await expect(page.getByTestId("sample-cost")).toContainText("$45.00");
    await page.getByTestId("approve").click();
    await page.getByTestId("approve-confirm").click();
    await page.waitForURL(/\/app\/lines\/REQ-2026-0312-02/);
    await expect(page.getByTestId("milestone-suffix")).toContainText("Order confirmed");
    await expect(page.getByTestId("sub-label")).toContainText("Preparing your order confirmation");
  });
});

test("cross-links: accepted offer → Confirm order from the offer tab (?lineId) and the request page (?req)", async ({ page }) => {
  // depends on "KOFF accepts gloves offer" above (REQ-2026-0301-01 is offer_accepted)
  await login(page, "bogdan@influensia.ro");
  await page.goto("/ops/lines/REQ-2026-0301-01?tab=offer");
  const fromOffer = page.getByTestId("confirm-order");
  await expect(fromOffer).toHaveAttribute("href", "/ops/orders/new?lineId=REQ-2026-0301-01");
  await fromOffer.click();
  await page.waitForURL(/\/ops\/orders\/new\?lineId=REQ-2026-0301-01/);
  await expect(page.locator("h1")).toContainText("Confirm order");
  await expect(page.locator("header")).toContainText("REQ-2026-0301");
  await page.goto("/ops/requests/REQ-2026-0301");
  const fromRequest = page.getByTestId("confirm-order-link");
  await expect(fromRequest).toHaveAttribute("href", "/ops/orders/new?req=REQ-2026-0301");
  await fromRequest.click();
  await page.waitForURL(/\/ops\/orders\/new\?req=REQ-2026-0301/);
  await expect(page.locator("h1")).toContainText("Confirm order");
});
