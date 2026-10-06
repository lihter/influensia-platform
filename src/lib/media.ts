/**
 * Image URL helpers shared by server and browser code (no dependencies).
 * Thumbnails are served by /api/files/<key>?w=<width>: resized + re-encoded server-side, cached per process and in the
 * browser, so a 56 px table thumb downloads ~5 KB instead of the multi-MB original.
 */

/** The only widths the file route renders — a closed set keeps the cache small and the route un-abusable. */
export const THUMB_WIDTHS = [96, 160, 320, 640] as const;
export type ThumbWidth = (typeof THUMB_WIDTHS)[number];

export const isThumbWidth = (w: number): w is ThumbWidth => (THUMB_WIDTHS as readonly number[]).includes(w);

/** Smallest rendered width that stays sharp at `cssPx` on a 2× screen. */
export function thumbWidthFor(cssPx: number): ThumbWidth {
  return THUMB_WIDTHS.find((w) => w >= cssPx * 2) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
}

/** `/api/files/…` → its resized variant; other URLs (external, data:) are returned unchanged. */
export function thumbUrl(url: string, cssPx: number): string {
  if (!url.startsWith("/api/files/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${thumbWidthFor(cssPx)}`;
}

/** "allegro.pl" from the first parsable link — shown on the placeholder while a line has no photo. */
export function linkDomain(links: readonly string[] | null | undefined): string | null {
  for (const u of links ?? []) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { /* not a URL */ }
  }
  return null;
}
