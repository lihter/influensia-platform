import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * F-26 clients admin · F-27 outbox · F-01 settings (runs against the e2e seed, see playwright.config.ts):
 *  1. AC-CLI-01 list counts · AC-CLI-04 "+ Client" creates org + first user with defaults · one-time temp password
 *  2. AC-CLI-02 invite → outbox `auth_invite` pending → "Run worker now" → sent + outbox.log grows (AC-OUT-02 mechanics)
 *  3. AC-CLI-03 agent sees read-only settings, no "Invite user"
 *  4. pricing rules edit as admin (/ops/settings); agent read-only
 *  5. the invited user signs in with the temp password, renames, changes password, signs in again (F-01)
 */
const PASSWORD = "Password123!";
const LOG = ".data/e2e/outbox.log";

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(app|ops)(\?|$)/);
}
const logLines = () => { try { return readFileSync(LOG, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };

test.describe.serial("clients admin, outbox, settings", () => {
  let tempPassword = "";
  let clientUrl = "";

  test("AC-CLI-01 · AC-CLI-04: list counts, + Client creates org + first user", async ({ page }) => {
    await login(page, "marko@influensia.ro");
    await page.goto("/ops/clients");
    const rows = page.locator("[data-testid=clients-table] tr[data-testid=data-row]");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "KOFF" })).toContainText(/PL.*Agency pass-through.*Factory \+ fee.*FOB.*7.*1/);
    await expect(rows.filter({ hasText: "Piotr's team" })).toContainText(/PL.*Agency pass-through.*Factory \+ fee.*FOB.*8.*1/);

    await page.click("[data-testid=new-client]");
    await page.fill("#orgName", "Pevex");
    await page.fill("#country", "HR");
    await page.fill("#userName", "Ana Horvat");
    await page.fill("#email", "pevex@example.hr");
    await page.click("form button[type=submit]");
    const dialog = page.getByTestId("invite-result");
    await expect(dialog).toBeVisible();
    tempPassword = (await dialog.getByTestId("cred-temporary-password").innerText()).trim();
    expect(tempPassword.length).toBeGreaterThan(10);
    await expect(dialog.getByTestId("cred-invite-link")).toContainText("/invite/");
    await dialog.getByRole("link", { name: "Open client" }).click();
    await page.waitForURL(/\/ops\/clients\/[0-9a-f-]{36}$/);
    clientUrl = page.url();
    // defaults from SPEC 1.3 on the settings form
    await expect(page.locator("#commercialMode")).toHaveValue("agency_passthrough");
    await expect(page.locator("#pricingDisplay")).toHaveValue("factory_plus_fee");
    await expect(page.locator("#defaultIncoterm")).toHaveValue("FOB");
    await expect(page.locator("#depositPct")).toHaveValue("30");
    await expect(page.locator("[data-testid=client-users] tr[data-testid=data-row]")).toHaveCount(1);
    await expect(page.locator("[data-testid=client-users] [data-status=invited]")).toBeVisible();
    // list shows it with 0 lines
    await page.goto("/ops/clients");
    await expect(page.locator("[data-testid=clients-table] tr[data-testid=data-row]").filter({ hasText: "Pevex" })).toContainText(/HR.*1.*0.*0/);
  });

  test("AC-CLI-02 · AC-OUT-02: invite writes a pending auth_invite; Run worker now sends it and grows the log", async ({ page }) => {
    await login(page, "marko@influensia.ro");
    await page.goto("/ops/outbox?status=pending");
    const pendingRows = page.locator("[data-testid=outbox-table] tr[data-testid=data-row]");
    await expect(pendingRows.filter({ hasText: "auth_invite" }).filter({ hasText: "pevex@example.hr" })).toHaveCount(1);
    await pendingRows.first().click();
    await expect(page.getByTestId("outbox-detail")).toBeVisible();
    await expect(page.getByTestId("outbox-payload")).toContainText("/invite/");
    await page.keyboard.press("Escape");
    const before = logLines();
    const pendingBefore = await pendingRows.count();
    await page.click("[data-testid=run-worker]");
    await expect(page.getByText(/Worker ran/)).toBeVisible();
    await page.goto("/ops/outbox?status=pending");
    await expect(page.locator("[data-testid=outbox-table] tr[data-testid=data-row]")).toHaveCount(0);
    expect(logLines()).toBe(before + pendingBefore);
    await page.goto("/ops/outbox?template=auth_invite&status=sent");
    const sentRow = page.locator("[data-testid=outbox-table] tr[data-testid=data-row]").filter({ hasText: "pevex@example.hr" });
    await sentRow.click();
    await expect(page.getByTestId("outbox-log-line")).toContainText('"template":"auth_invite"');
  });

  test("AC-CLI-03: agent sees read-only settings and no Invite user", async ({ page }) => {
    await login(page, "bogdan@influensia.ro");
    await page.goto(clientUrl);
    await expect(page.getByTestId("client-settings-readonly")).toBeVisible();
    await expect(page.getByTestId("client-settings-form")).toHaveCount(0);
    await expect(page.getByTestId("invite-user")).toHaveCount(0);
    await page.goto("/ops/settings");
    await expect(page.getByTestId("pricing-rules")).toBeVisible();
    await expect(page.getByTestId("add-rule")).toHaveCount(0);
    await page.goto("/ops/outbox");
    await expect(page.getByTestId("run-worker")).toHaveCount(0);
  });

  test("pricing rules: admin edits fitness margin inline", async ({ page }) => {
    await login(page, "marko@influensia.ro");
    await page.goto("/ops/settings");
    await page.click("[data-testid=rule-fitness-edit]");
    await page.fill("[data-testid=rule-fitness-marginPct]", "19");
    await page.click("[data-testid=rule-fitness-save]");
    await expect(page.getByText("Rule fitness saved — new offers only")).toBeVisible();
    await expect(page.locator("[data-testid=pricing-rules] tr").filter({ hasText: "fitness" })).toContainText("19 %");
  });

  test("F-01: invited user signs in with the temp password, renames, changes password", async ({ page }) => {
    await login(page, "pevex@example.hr", tempPassword);
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/settings");
    await expect(page.getByTestId("temp-password-nudge")).toBeVisible();
    const html = (await page.content()).replace(/<script[\s\S]*?<\/script>/g, "");
    expect(html).not.toMatch(/organi[sz]ation|supplier/i);
    await page.fill("#name", "Ana Horvat-Kos");
    await page.click("[data-testid=save-name]");
    await expect(page.getByText("Name saved")).toBeVisible();
    await page.fill("#currentPassword", tempPassword);
    await page.fill("#newPassword", "PevexSecret2026");
    await page.fill("#confirm", "PevexSecret2026");
    await page.click("[data-testid=change-password]");
    await expect(page.getByText("Password changed")).toBeVisible();
    await expect(page.getByTestId("temp-password-nudge")).toHaveCount(0);
    await page.goto("/logout");
    await login(page, "pevex@example.hr", "PevexSecret2026");
    await expect(page).toHaveURL(/\/app$/);
    // the ops side now shows the user as Active
    await page.goto("/logout");
    await login(page, "marko@influensia.ro");
    await page.goto(clientUrl);
    await expect(page.locator("[data-testid=client-users] [data-status=active]")).toBeVisible();
    await expect(page.locator("[data-testid=client-users]")).toContainText("Ana Horvat-Kos");
  });
});
