import { createReadStream } from "node:fs";
import { mkdir, writeFile, stat, copyFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { StorageAdapter, StorageKey } from "./types";

const KEY_RE = /^org\/[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}\/(client|internal)\/[0-9a-f-]{36}(\.[a-z0-9]+)?$/i;

export function assertValidKey(key: string): asserts key is StorageKey {
  if (!KEY_RE.test(key) || key.includes("..")) throw new Error(`invalid storage key: ${key}`);
}

export class LocalDiskStorage implements StorageAdapter {
  constructor(private root = process.env.FILES_DIR ?? path.join(process.cwd(), ".data", "files")) {}
  private abs(key: string) { assertValidKey(key); return path.join(this.root, key); }
  private metaPath(key: string) { return this.abs(key) + ".meta.json"; }

  async put(key: string, data: Buffer | Uint8Array, contentType: string) {
    const p = this.abs(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
    await writeFile(this.metaPath(key), JSON.stringify({ contentType }));
    return { bytes: data.byteLength };
  }
  async get(key: string) {
    const p = this.abs(key);
    try {
      const s = await stat(p);
      const meta = JSON.parse(await (await import("node:fs/promises")).readFile(this.metaPath(key), "utf8")) as { contentType: string };
      return { body: Readable.toWeb(createReadStream(p)) as ReadableStream<Uint8Array>, contentType: meta.contentType, bytes: s.size };
    } catch { return null; }
  }
  async copy(from: string, to: string) {
    const t = this.abs(to);
    await mkdir(path.dirname(t), { recursive: true });
    await copyFile(this.abs(from), t);
    await copyFile(this.metaPath(from), this.metaPath(to));
  }
  async delete(key: string) { await rm(this.abs(key), { force: true }); await rm(this.metaPath(key), { force: true }); }
  async exists(key: string) { try { await access(this.abs(key)); return true; } catch { return false; } }
  async downloadUrl(key: string, opts?: { filename?: string }) {
    assertValidKey(key);
    const q = opts?.filename ? `?filename=${encodeURIComponent(opts.filename)}` : "";
    return `/api/files/${key}${q}`;
  }
}
