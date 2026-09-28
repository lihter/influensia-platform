/**
 * EU date formatting for every screen (FIX_PHASE contract c). Pure, deterministic (explicit time zone, fixed English
 * month names) so server and browser render identical text — no hydration drift, no "10/12/2026" ambiguity.
 *
 *   fmtDate("2026-09-28T12:05:00Z")      // "28 Sep 2026"
 *   fmtDateShort(d)                      // "28 Sep"
 *   fmtDateTime(d)                       // "28 Sep 2026, 14:05"
 *   fmtDayTime(d)                        // "28 Sep, 14:05"  (tables, feeds without a day header)
 *   fmtTime(d)                           // "14:05"          (feeds under a day header)
 *   fmtInputDate("2026-10-12")           // "12.10.2026"     (what <DateInput> shows)
 *   parseInputDate("12.10.2026")         // "2026-10-12"     (what forms/actions receive; ISO yyyy-mm-dd)
 *   dayKey(d)                            // "2026-09-28" in the display zone (group feeds by day)
 *
 * Date-only strings ("2026-10-12") are calendar dates and are never shifted by the time zone.
 * Times display in Europe/Zagreb (ops, SPEC); the client zone (Warsaw) has the same offset. Pass `tz` to override.
 */
export const DISPLAY_TZ = "Europe/Zagreb";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export type DateLike = Date | string | number | null | undefined;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type Parts = { y: number; m: number; d: number; hh: number; mm: number };
const cache = new Map<string, Intl.DateTimeFormat>();
function partsOf(v: DateLike, tz = DISPLAY_TZ): Parts | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && DATE_ONLY.test(v)) { const [y, m, d] = v.split("-").map(Number); return { y, m, d, hh: 0, mm: 0 }; }
  const x = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(x.getTime())) return null;
  let f = cache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); cache.set(tz, f); }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(x)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, hh: o.hour % 24, mm: o.minute };
}
const pad = (n: number) => String(n).padStart(2, "0");

export const fmtDate = (v: DateLike, tz?: string) => { const p = partsOf(v, tz); return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : "—"; };
export const fmtDateShort = (v: DateLike, tz?: string) => { const p = partsOf(v, tz); return p ? `${p.d} ${MONTHS[p.m - 1]}` : "—"; };
export const fmtTime = (v: DateLike, tz?: string) => { const p = partsOf(v, tz); return p ? `${pad(p.hh)}:${pad(p.mm)}` : "—"; };
export const fmtDateTime = (v: DateLike, tz?: string) => { const p = partsOf(v, tz); return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}, ${pad(p.hh)}:${pad(p.mm)}` : "—"; };
export const fmtDayTime = (v: DateLike, tz?: string) => { const p = partsOf(v, tz); return p ? `${p.d} ${MONTHS[p.m - 1]}, ${pad(p.hh)}:${pad(p.mm)}` : "—"; };
/** yyyy-mm-dd of the instant in the display zone (group keys, compare days). */
export const dayKey = (v: DateLike, tz?: string) => { const p = partsOf(v, tz); return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : ""; };
/** `12.10.2026` for inputs. Accepts ISO date or instant. */
export const fmtInputDate = (v: DateLike, tz?: string) => { const p = partsOf(v, tz); return p ? `${pad(p.d)}.${pad(p.m)}.${p.y}` : ""; };

/**
 * Parse what a person types into an ISO date (yyyy-mm-dd), or null when it isn't a real date.
 * Accepts `12.10.2026`, `12/10/2026`, `12-10-2026`, `12.10.26`, `12.10.` (current year), `2026-10-12`. Day first, always.
 */
export function parseInputDate(text: string | null | undefined, refYear = new Date().getFullYear()): string | null {
  const s = String(text ?? "").trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else {
    mm = s.match(/^(\d{1,2})[./\-\s](\d{1,2})(?:[./\-\s](\d{2}|\d{4})?)?\.?$/);
    if (!mm) return null;
    d = +mm[1]; m = +mm[2]; y = mm[3] ? (mm[3].length === 2 ? 2000 + +mm[3] : +mm[3]) : refYear;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
