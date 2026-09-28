/**
 * Today-relative demo seed. The SPEC §7 dataset is written for "today" = 28 Sep 2026 (a Monday). `npm run db:seed`
 * moves EVERY absolute date it writes by `seedShiftDays()` whole calendar days, so the seed's "today" becomes the day
 * you run it and the app (which runs on the real clock) shows the same picture on any future day: 3 stale ·
 * 9 waiting on us · 3 waiting on client · 1 unassigned, offers still valid, ETAs in the future.
 *
 *   SEED_SHIFT_DAYS=0   → the literal SPEC dataset (28 Sep 2026). Unit tests pin this.
 *   SEED_SHIFT_DAYS=n   → explicit shift (any whole number).
 *   unset               → UTC date of (SEED_CLOCK ?? wall clock) − 2026-09-28.
 *
 * Why exact calendar days and not a multiple of 7: the running app counts staleness in working days against the REAL
 * clock, so the seed's "today" has to be the real today. The dataset keeps its margins for every weekday: lines that
 * must not be stale changed ≤ 6 calendar days ago (≤ 5 working days, never "> 5"), stale lines ≥ 11 calendar days
 * ago (≥ 7 working days). `npm run db:seed` re-checks this (SPEC §7.16) on the shifted data every time.
 *
 * Pure module (no server imports) — Playwright specs import it to compute their expected dates.
 */
export const SEED_BASE_DAY = "2026-09-28";
export const SEED_BASE_TIME = "09:00";
const DAY_MS = 86_400_000;
const utcMidnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function seedShiftDays(env: Record<string, string | undefined> = process.env, wall: Date = new Date()): number {
  const raw = env.SEED_SHIFT_DAYS?.trim();
  if (raw) {
    const n = Number(raw);
    if (!Number.isInteger(n)) throw new Error(`SEED_SHIFT_DAYS must be a whole number of days, got "${raw}"`);
    return n;
  }
  const pinned = env.SEED_CLOCK ? new Date(env.SEED_CLOCK) : null;
  const ref = pinned && !Number.isNaN(pinned.getTime()) ? pinned : wall;
  return Math.round((utcMidnight(ref) - Date.parse(`${SEED_BASE_DAY}T00:00:00Z`)) / DAY_MS);
}

/** "2026-09-25" + n days → yyyy-mm-dd (calendar arithmetic in UTC). */
export function shiftDay(day: string, n: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`shiftDay expects yyyy-mm-dd, got "${day}"`);
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The seed's "now" for a shift: 09:00 UTC on the shifted 28 Sep 2026. */
export const seedClockIso = (n: number) => `${shiftDay(SEED_BASE_DAY, n)}T${SEED_BASE_TIME}:00Z`;
