import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { resetDb, sd, sdLong, sdShort } from "./helpers";

/**
 * Orders + documents (F-10, F-22, F-23) against a fresh seed:
 *  ops: list → ORD-2026-0312 page → mark balance… (deposit already paid in seed, so we drive KOFF gloves? no — we drive 0312:
 *  edit the PO ETA (eta_changed), upload + publish a clean document, leak-check block on a ZZLEAKTEST-named file,
 *  record inspection pass (→ awaiting_balance), mark balance paid, record forwarder, ship, depart, arrive, deliver.
 *  client (piotr): order page shows the published doc, downloads it, internal doc key is 404, confirms delivery, reorders.
 */
const PASSWORD = "Password123!";
const FIX = path.join(process.cwd(), "docs", "fixtures");

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(app|ops)(\?|$)/);
}

test.beforeAll(resetDb); // each spec file starts from the freshly seeded snapshot

test.describe.configure({ mode: "serial" });

test("ops orders list shows both seeded orders with amounts and ETA", async ({ page }) => {
  await login(page, "bogdan@influensia.ro");
  await page.goto("/ops/orders");
  const table = page.getByTestId("orders-table");
  await expect(table).toContainText("ORD-2026-0312");
  await expect(table).toContainText("ORD-2026-0290");
  await expect(table).toContainText("$4,340.00"); // balance due on 0312
  await expect(table).toContainText(sdShort("2026-11-18"));    // planned ETA Gdańsk
  await page.getByTestId("orders-toolbar").getByText("Piotr", { exact: false }).first().click();
  await expect(table).not.toContainText("ORD-2026-0290");
});

test("ops order page: AC-OO-01/02, ETA change, publish + leak check, inspection pass, ship, deliver", async ({ page }) => {
  await login(page, "bogdan@influensia.ro");
  await page.goto("/ops/orders/ORD-2026-0312");
  // AC-OO-01
  await expect(page.locator("[data-state=in_production]").first()).toBeVisible();
  await expect(page.getByTestId("section-purchase-orders")).toContainText("PO-2026-0312-01");
  await expect(page.getByTestId("section-purchase-orders")).toContainText("$5,390.00");
  await expect(page.getByTestId("section-purchase-orders")).toContainText(sdLong("2026-10-25"));
  // AC-OO-02
  const pay = page.getByTestId("payments-table");
  await expect(pay.locator("[data-kind=deposit]")).toContainText("WIRE-0922-A");
  await expect(pay.locator("[data-kind=balance]")).toContainText("on QC pass");
  // AC-DOC-01
  const docs = page.getByTestId("section-documents");
  await expect(docs).toContainText("PI-ORD-2026-0312.pdf");
  await expect(docs).toContainText(`quote-${sd("2026-09-12")}-copy.xlsx`);
  await expect(docs.locator("[data-testid=document-row]", { hasText: `quote-${sd("2026-09-12")}-copy.xlsx` }).getByTestId("publish")).toHaveCount(0);

  // AC-OO-09: edit PO ETA → eta_changed on the timeline
  await page.getByTestId("edit-eta").click();
  await page.fill("#exworksEta", sd("2026-11-12"));
  await page.getByRole("button", { name: "Save ETA" }).click();
  await expect(page.getByTestId("section-purchase-orders")).toContainText(sdLong("2026-11-12"), { timeout: 30_000 });
  await expect(page.getByTestId("section-timeline")).toContainText("ETA updated");

  // AC-DOC-05: a file named after the canary is blocked on the filename
  await page.getByTestId("upload-document").click();
  await page.setInputFiles("#file", { name: "ZZLEAKTEST price list.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 clean body") });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const leakRow = docs.locator("[data-testid=document-row]", { hasText: "ZZLEAKTEST price list.pdf" });
  await expect(leakRow).toBeVisible({ timeout: 30_000 });
  await leakRow.getByTestId("publish").click();
  await expect(page.getByTestId("publish-blocked")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("leak-check-result")).toContainText("ZZLEAKTEST");
  await page.keyboard.press("Escape");
  await expect(leakRow).toContainText("Internal");

  // AC-DOC-02: leaky text layer blocked; AC-DOC-03: clean report publishes
  await page.getByTestId("upload-document").click();
  await page.locator("#kind").click();
  await page.getByRole("option", { name: "qc report" }).click();
  await page.setInputFiles("#file", path.join(FIX, "leaky-report.pdf"));
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const leaky = docs.locator("[data-testid=document-row]", { hasText: "leaky-report.pdf" });
  await expect(leaky).toBeVisible({ timeout: 30_000 });
  await leaky.getByTestId("publish").click();
  await expect(page.getByTestId("publish-blocked")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("leak-check-result")).toContainText("Yuantuo");
  await page.keyboard.press("Escape");

  await page.getByTestId("upload-document").click();
  await page.setInputFiles("#file", path.join(FIX, "clean-report.pdf"));
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const clean = docs.locator("[data-testid=document-row]", { hasText: "clean-report.pdf" });
  await expect(clean).toBeVisible({ timeout: 30_000 });
  await clean.getByTestId("publish").click();
  await expect(page.getByTestId("publish-confirm")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("publish-confirm").click();
  await expect(clean).toContainText("Client", { timeout: 30_000 });
  await expect(page.getByTestId("section-timeline")).toContainText("Publish blocked");

  // AC-OO-03: record inspection pass → awaiting_balance, balance due set
  await page.getByTestId("record-inspection").click();
  await page.fill("#defectsNote", "0 critical, 2 minor");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.locator("[data-state=awaiting_balance]").first()).toBeVisible({ timeout: 30_000 });
  await expect(pay.locator("[data-kind=balance]")).not.toContainText("on QC pass");

  // balance paid
  await page.getByTestId("mark-paid").click();
  await page.fill("#reference", "WIRE-1024-B");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(pay.locator("[data-kind=balance]")).toContainText("WIRE-1024-B", { timeout: 30_000 });

  // forwarder → shipped → departed → arrived → delivered
  await page.getByTestId("record-forwarder").click();
  await page.fill("#forwarder", "Rohlig Suus");
  await page.fill("#bookingRef", "RS-2026-11-0001");
  await page.fill("#cargoReady", sd("2026-11-13"));
  await page.getByRole("button", { name: "Book forwarder" }).click();
  await expect(page.locator("[data-state=forwarder_booked]").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("mark-shipped").click();
  await page.getByRole("button", { name: "Mark shipped", exact: true }).click();
  await expect(page.locator("[data-state=shipped_exworks]").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("mark-departed").click();
  await page.fill("#containerOrAwb", "MSKU9999001");
  await page.fill("#etd", sd("2026-11-16"));
  await page.fill("#etaPort", sd("2026-12-20"));
  await page.getByRole("button", { name: "Confirm departure" }).click();
  await expect(page.locator("[data-state=departed_origin]").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("section-timeline")).toContainText(`ETA updated — port ${sdLong("2026-12-20")}`);
  await page.getByTestId("mark-arrived").click();
  await page.getByRole("button", { name: "Mark arrived" }).click();
  await expect(page.locator("[data-state=eu_port_customs]").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("mark-delivered").click();
  await page.getByRole("button", { name: "Confirm delivered" }).click();
  await expect(page.locator("[data-state=delivered]").first()).toBeVisible({ timeout: 30_000 });
});

test("client order page: published doc downloadable, internal key 404, confirm delivery, reorder", async ({ page }) => {
  await login(page, "piotr@example.pl");
  await page.goto("/app/orders/ORD-2026-0312");
  // AC-ORD-02
  const html = await page.content();
  expect(html).not.toMatch(/PO-2026|Yuantuo|ZZLEAKTEST|T\/T|Daryl|\+86/);
  await page.getByTestId("tab-documents").click();
  const list = page.getByTestId("client-documents");
  await expect(list).toContainText("clean-report.pdf");
  await expect(list).not.toContainText("leaky-report.pdf");
  await expect(list).not.toContainText("ZZLEAKTEST");
  const rows = list.locator("[data-testid=document-row]", { hasText: "clean-report.pdf" });
  const dl = await rows.locator("a[download]").getAttribute("href");
  expect(dl).toMatch(/\/api\/files\/org\/.*\/client\//);
  const res = await page.request.get(dl!);
  expect(res.status()).toBe(200);
  // AC-DOC-04: an internal key is 404 for the client
  const internalKey = dl!.replace("/client/", "/internal/").split("?")[0];
  expect((await page.request.get(internalKey)).status()).toBe(404);
  // delivered → confirm
  await expect(page.getByTestId("milestone-suffix")).toContainText("Delivered"); // FIX-B: one status chip, no "· 9 of 9" suffix
  await page.getByTestId("confirm-delivery").first().click();
  await page.getByTestId("confirm-delivery-submit").click();
  await expect(page.getByTestId("confirm-delivery")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("tab", { name: "Updates" }).click();
  await expect(page.getByTestId("client-order")).toContainText("Delivery confirmed");
  // reorder
  await page.getByTestId("reorder").click();
  await page.getByRole("button", { name: "Create request" }).click();
  await page.waitForURL(/\/app\/requests\/REQ-2026-\d{4}/, { timeout: 30_000 });

});

test("AC-ORD-05: client confirm-delivery rolls up supplier performance (shared recordSupplierPerformance)", async ({ page }) => {
  await login(page, "bogdan@influensia.ro");
  await page.goto("/ops/suppliers/SUP-0007");
  await page.click("button[role=tab]:has-text('Performance')");
  const orders = page.getByTestId("performance").getByTestId("kpi-tile").filter({ hasText: "Orders" });
  await expect(orders.getByTestId("kpi-value")).toHaveText("1"); // seed 0 → ORD-2026-0312 completed by Piotr above
});
