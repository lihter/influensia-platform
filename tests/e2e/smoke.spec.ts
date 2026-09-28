import { test, expect, type Page } from "@playwright/test";

/**
 * Foundation smoke (runs against a freshly seeded PGlite dir, see playwright.config.ts):
 *  1. client login → /app dashboard shows seeded content (AC-AUTH-01, AC-DASH-01, AC-DASH-03)
 *  2. agent login → /ops dashboard shows KPI tiles (AC-AUTH-02, AC-OPS-01/02/03)
 *  3. client visiting /ops gets 404 (AC-AUTH-03); agent visiting /app is redirected to /ops (AC-AUTH-04)
 *  4. no session → /login?next= (AC-AUTH-05); sign out works
 */
const PASSWORD = "Password123!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(app|ops)(\?|$)/);
}

test("unauthenticated /app redirects to /login?next=", async ({ page }) => {
  const res = await page.goto("/app/orders/ORD-2026-0312");
  expect(res?.url()).toContain("/login?next=%2Fapp%2Forders%2FORD-2026-0312");
  await expect(page.getByTestId("login-form")).toBeVisible();
});

test("wrong password shows a generic error", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "piotr@example.pl");
  await page.fill("#password", "nope-nope-nope");
  await page.click("button[type=submit]");
  await expect(page.getByTestId("login-error")).toContainText("Email or password is incorrect");
});

test("client login → /app dashboard with seeded content, no supplier leaks", async ({ page }) => {
  await login(page, "piotr@example.pl");
  await expect(page).toHaveURL(/\/app$/);
  // nav (AC-AUTH-01)
  const nav = page.locator("nav[aria-label=Main]").first();
  await expect(nav).toContainText("Dashboard");
  await expect(nav).toContainText("Requests & orders");
  await expect(nav).toContainText("Catalog");
  // AC-DASH-01: exactly one waiting card
  const items = page.getByTestId("waiting-item");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Sample received — Standard sleeves 66×91 mm, 80 µm");
  await expect(items.first().getByRole("link", { name: "Approve sample" })).toBeVisible();
  // AC-DASH-03: groups + counts + ETA
  const groups = page.getByTestId("active-groups");
  await expect(groups.locator("[data-milestone-group=in_production]")).toContainText("ETA Gdańsk 18 Nov 2026");
  await expect(groups.locator("[data-milestone-group=finding_factory] [data-testid=active-line]")).toHaveCount(6);
  await expect(groups.locator("[data-milestone-group=sample] [data-testid=active-line]")).toHaveCount(1);
  await expect(groups.locator("[data-ref='REQ-2026-0312-11']")).toContainText("3 contacted · 2 quoted");
  // AC-DASH-04: no supplier identifiers anywhere in the document
  const html = await page.content();
  expect(html).not.toMatch(/ZZLEAKTEST|Yuantuo|Suti|Yili|依立|Dr\. Card|Boyuan|Fuli|Jinou|SUP-00|PO-2026/);
  // AC-AUTH-03: /ops is a 404 for a client
  const res = await page.goto("/ops");
  expect(res?.status()).toBe(404);
  await expect(page.locator("body")).not.toContainText("Stale");
});

test("KOFF buyer sees two waiting cards and the phone layout has no horizontal scroll", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await login(page, "buyer@koff.example");
  const items = page.getByTestId("waiting-item");
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId("waiting-card")).toContainText("Price ready — Work gloves");
  await expect(page.getByTestId("waiting-card")).toContainText("Confirm you received ORD-2026-0290");
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await ctx.close();
});

test("agent login → /ops dashboard with KPI tiles; /app redirects to /ops; sign out", async ({ page }) => {
  await login(page, "bogdan@influensia.ro");
  await expect(page).toHaveURL(/\/ops$/);
  await page.goto("/ops?scope=all");
  const tiles = page.getByTestId("kpi-tile");
  await expect(tiles).toHaveCount(4);
  const values = await page.getByTestId("kpi-value").allTextContents();
  expect(values).toEqual(["3", "10", "3", "1"]);
  // AC-OPS-01
  const stale = page.getByTestId("section-stale");
  await expect(stale).toContainText("REQ-2026-0312-14");
  await expect(stale).toContainText("REQ-2026-0318-01");
  await expect(stale).toContainText("REQ-2026-0312-26");
  // AC-OPS-02 / 03
  await expect(page.getByTestId("section-waiting-client")).toContainText("ORD-2026-0290");
  await expect(page.getByTestId("section-unassigned")).toContainText("REQ-2026-0325-01");
  await expect(page.getByTestId("claim")).toBeVisible();
  // the canary IS reachable for ops (proves the leak test is not vacuous): sidebar + placeholder pages render
  await expect(page.getByTestId("ops-sidebar")).toContainText("Suppliers");
  // AC-AUTH-04
  await page.goto("/app");
  await expect(page).toHaveURL(/\/ops$/);
  // sign out
  await page.goto("/logout");
  await expect(page).toHaveURL(/\/login/);
  const res = await page.goto("/ops");
  expect(res?.url()).toContain("/login?next=%2Fops");
});

test("claim assigns the unassigned line to me and clears the queue", async ({ page }) => {
  await login(page, "bogdan@influensia.ro");
  await page.goto("/ops?scope=all");
  await page.getByTestId("claim").click();
  await expect(page.getByTestId("section-unassigned")).not.toContainText("REQ-2026-0325-01", { timeout: 20_000 });
  await expect(page.getByTestId("section-waiting-us")).toContainText("REQ-2026-0325-01");
});
