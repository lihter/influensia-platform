/**
 * Timeline read-model helpers (UX review "Timelines: deduplicated"). Pure.
 *
 * `collapseRepeats()` drops an item when an item with the same key (event type + visible text) was already kept within
 * `windowMs` (default 10 minutes). Items keep their input order (newest first in every read model), so the newest copy
 * survives. Items whose key is null (comments, client questions…) are never collapsed.
 */
export const COLLAPSE_WINDOW_MS = 10 * 60 * 1000;

export function collapseRepeats<T>(items: readonly T[], keyOf: (t: T) => string | null, atOf: (t: T) => string | Date, windowMs = COLLAPSE_WINDOW_MS): T[] {
  const lastKept = new Map<string, number[]>();
  const out: T[] = [];
  for (const it of items) {
    const key = keyOf(it);
    if (key === null) { out.push(it); continue; }
    const at = new Date(atOf(it)).getTime();
    const times = lastKept.get(key) ?? [];
    if (times.some((t) => Math.abs(t - at) <= windowMs)) continue;
    times.push(at);
    lastKept.set(key, times);
    out.push(it);
  }
  return out;
}

const squash = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Client Updates feed items: events collapse on their text; comments never. */
export const collapseClientUpdates = <T extends { kind: string; text: string; at: string }>(items: readonly T[], windowMs = COLLAPSE_WINDOW_MS) =>
  collapseRepeats(items, (u) => (u.kind === "event" ? `event|${squash(u.text)}` : null), (u) => u.at, windowMs);

/** Request pages aggregate many lines: the same sentence twice on one day ("RFQ out" for six lines) is one fact. */
export const SAME_DAY_MS = 12 * 60 * 60 * 1000;

/** Client History items: collapse on the visible text (two event types rendering the same sentence are one fact). */
export const collapseClientHistory = <T extends { text: string; at: string }>(items: readonly T[], windowMs = COLLAPSE_WINDOW_MS) =>
  collapseRepeats(items, (e) => `${e.at.slice(0, 10)}|${squash(e.text)}`, (e) => e.at, windowMs);

/** Ops feeds: system events collapse on type + title; comments / notes / WhatsApp logs never. */
export const collapseOpsFeed = <T extends { source?: string; kind?: string; type: string | null; title: string | null; at: string }>(items: readonly T[]) =>
  collapseRepeats(items, (e) => (e.source === "comment" || (e.kind && e.kind !== "milestone" && e.kind !== "action_milestone" && e.kind !== "system" && e.kind !== "document") || !e.type ? null : `${e.type}|${squash(e.title ?? "")}`), (e) => e.at);
