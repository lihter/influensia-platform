import type { Page } from "@playwright/test";

export const PASSWORD = "Password123!";
export const BASE_URL = `http://localhost:${Number(process.env.E2E_PORT ?? 3100)}`;

/**
 * Restore the freshly seeded snapshot (POST /api/test/reset, E2E-only). Call once per spec file:
 *   test.beforeAll(resetDb);
 * Spec files share one server and one PGlite dir; this makes each file start from the SPEC §7 seed.
 */
export async function resetDb(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/test/reset`, { method: "POST" });
  if (!res.ok) throw new Error(`reset failed: ${res.status} ${await res.text()}`);
}

export async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(app|ops)(\?|$)/);
}
