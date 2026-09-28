import { format, formatDistanceToNowStrict, differenceInCalendarDays, addDays, isWeekend } from "date-fns";
import { now } from "./clock";

export const DISPLAY_TZ_OPS = "Europe/Zagreb";
export const DISPLAY_TZ_CLIENT_DEFAULT = "Europe/Warsaw";

type DateLike = Date | string | null | undefined;

const toDate = (d: DateLike): Date | null => {
  if (!d) return null;
  const x = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  return Number.isNaN(x.getTime()) ? null : x;
};

/** `22 Sep 2026` (prose). */
export function formatDate(d: DateLike, pattern = "d MMM yyyy"): string {
  const x = toDate(d);
  return x ? format(x, pattern) : "—";
}
/** `22 Sep` (tables). */
export const formatDateShort = (d: DateLike) => formatDate(d, "d MMM");
/** `22 Sep 2026, 14:05`. */
export const formatDateTime = (d: DateLike) => formatDate(d, "d MMM yyyy, HH:mm");
/** ISO for tooltips. */
export const formatIso = (d: DateLike) => toDate(d)?.toISOString() ?? "";

export function relative(d: DateLike): string {
  const x = toDate(d);
  return x ? formatDistanceToNowStrict(x, { addSuffix: true }) : "—";
}

/** Whole days between two instants (calendar days, UTC). */
export function daysBetween(from: DateLike, to: DateLike = now()): number {
  const a = toDate(from), b = toDate(to);
  if (!a || !b) return 0;
  return differenceInCalendarDays(b, a);
}

/** `15 d` age label used in the stale column. */
export const ageLabel = (d: DateLike, ref: DateLike = now()) => `${daysBetween(d, ref)} d`;

/**
 * Working days (Mon–Fri, no holiday calendar) between `from` and `to`, exclusive of the start day, inclusive of `to`.
 * SPEC B.3: stale when > 5.
 */
export function workingDaysBetween(from: DateLike, to: DateLike = now()): number {
  const a = toDate(from), b = toDate(to);
  if (!a || !b || b <= a) return 0;
  let count = 0;
  let cur = addDays(new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())), 1);
  const end = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
  while (cur <= end) {
    if (!isWeekend(cur)) count++;
    cur = addDays(cur, 1);
  }
  return count;
}

/** Adds N working days to a date (skips Sat/Sun). */
export function addWorkingDays(from: DateLike, n: number): Date {
  let cur = toDate(from) ?? now();
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (!isWeekend(cur)) left--;
  }
  return cur;
}

export const isoDate = (d: DateLike): string | null => { const x = toDate(d); return x ? x.toISOString().slice(0, 10) : null; };
