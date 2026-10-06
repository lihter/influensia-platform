/**
 * Resized image variants for /api/files/<key>?w=<width> (see @/lib/media). Rendered with sharp to WebP, kept in a
 * bounded in-process LRU (keys are immutable uuids, so a cached variant never goes stale). Browsers cache them too.
 * Cost on a miss: one sharp resize (~10–30 ms for a typical upload); on a hit: a Map lookup.
 */
import { Readable } from "node:stream";
import type { ThumbWidth } from "@/lib/media";
import type { StoredObject } from "./storage/types";

const MAX_CACHE_BYTES = 48 * 1024 * 1024;
const QUALITY = 78;

type G = { __influensiaVariants?: { map: Map<string, Buffer>; bytes: number } };
const g = globalThis as unknown as G;
const cache = (g.__influensiaVariants ??= { map: new Map(), bytes: 0 });

function remember(id: string, buf: Buffer) {
  cache.map.set(id, buf);
  cache.bytes += buf.length;
  for (const [k, v] of cache.map) {           // Map iterates oldest first → evict least recently used
    if (cache.bytes <= MAX_CACHE_BYTES) break;
    cache.map.delete(k);
    cache.bytes -= v.length;
  }
}

async function toBuffer(body: StoredObject["body"]): Promise<Buffer> {
  const web = body instanceof Readable ? (Readable.toWeb(body) as ReadableStream<Uint8Array>) : body;
  return Buffer.from(await new Response(web).arrayBuffer());
}

export const VARIANT_CONTENT_TYPE = "image/webp";

/**
 * The `width`-wide square WebP of a stored image (never upscaled), or null when the object is missing or not an image.
 * A cache hit never touches storage.
 */
export async function imageVariant(key: string, width: ThumbWidth, load: () => Promise<StoredObject | null>): Promise<Buffer | null> {
  const id = `${key}@${width}`;
  const hit = cache.map.get(id);
  if (hit) { cache.map.delete(id); cache.map.set(id, hit); return hit; }   // refresh recency
  const obj = await load();
  if (!obj || !obj.contentType.startsWith("image/")) return null;
  const sharp = (await import("sharp")).default;
  const out = await sharp(await toBuffer(obj.body)).rotate().resize({ width, height: width, fit: "cover", withoutEnlargement: true }).webp({ quality: QUALITY }).toBuffer();
  remember(id, out);
  return out;
}
