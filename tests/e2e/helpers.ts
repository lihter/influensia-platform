import type { Page } from "@playwright/test";
import { seedShiftDays, shiftDay } from "../../src/db/seed-clock";
import { fmtDate, fmtDateShort } from "../../src/lib/format-date";

export const PASSWORD = "Password123!";
export const BASE_URL = `http://localhost:${Number(process.env.E2E_PORT ?? 3100)}`;

/**
 * The e2e seed is today-relative like `npm run db:seed` (src/db/seed-clock.ts): playwright.config.ts resolves
 * SEED_SHIFT_DAYS once per run and hands the same value to the seeding web server and to every spec. Expected dates
 * are therefore written as SPEC §7 dates and shifted here, never as literals:
 *   sd("2026-11-18") → "2026-12-02" (shift 14) · sdLong("2026-11-18") → "2 Dec 2026" · sdShort("2026-11-18") → "2 Dec"
 */
export const SEED_SHIFT = seedShiftDays();
export const sd = (day: string) => shiftDay(day, SEED_SHIFT);
export const sdLong = (day: string) => fmtDate(sd(day));
export const sdShort = (day: string) => fmtDateShort(sd(day));

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
