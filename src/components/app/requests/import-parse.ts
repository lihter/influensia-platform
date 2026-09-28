/**
 * Browser-side CSV / xlsx import for the intake form (SPEC F-04 "xlsx import"). No external library: CSV is parsed by
 * hand and xlsx (a zip of XML) is unpacked with the platform's DecompressionStream("deflate-raw"). We only need the
 * first worksheet + shared strings, which is enough to prefill name / link / qty / note rows.
 */

export type ImportedRow = { name: string; link: string | null; qty: number | null; note: string | null };
export type ImportResult = { ok: true; rows: ImportedRow[]; sheet: string } | { ok: false; reason: "no_header" | "empty" | "unreadable" };

const HEADER = {
  name: /^(name|product|product ?name|item|description|nazwa|produkt)$/i,
  link: /^(link|url|links|source|allegro|alibaba)$/i,
  qty: /^(qty|quantity|q'ty|pcs|ilość|ilosc|amount)$/i,
  note: /^(note|notes|comment|comments|remarks|uwagi)$/i,
};

/** Finds the header row (must contain name|product) and maps rows below it. */
export function rowsFromGrid(grid: string[][], sheet = "Sheet1"): ImportResult {
  if (!grid.length) return { ok: false, reason: "empty" };
  let headerAt = -1;
  let cols: { name: number; link: number; qty: number; note: number } | null = null;
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const row = grid[i].map((c) => c.trim());
    const name = row.findIndex((c) => HEADER.name.test(c));
    if (name < 0) continue;
    cols = { name, link: row.findIndex((c) => HEADER.link.test(c)), qty: row.findIndex((c) => HEADER.qty.test(c)), note: row.findIndex((c) => HEADER.note.test(c)) };
    headerAt = i;
    break;
  }
  if (headerAt < 0 || !cols) return { ok: false, reason: "no_header" };
  const rows: ImportedRow[] = [];
  for (const raw of grid.slice(headerAt + 1)) {
    const cell = (i: number) => (i >= 0 ? (raw[i] ?? "").trim() : "");
    const name = cell(cols.name);
    const link = cell(cols.link);
    if (!name && !link) continue;
    const qtyText = cell(cols.qty).replace(/[^\d.,]/g, "").replace(/[.,](?=\d{3}\b)/g, "");
    const qty = qtyText ? Math.round(Number(qtyText.replace(",", "."))) : null;
    rows.push({ name: name || link, link: /^https?:\/\//i.test(link) ? link : null, qty: qty && Number.isFinite(qty) && qty > 0 ? qty : null, note: cell(cols.note) || null });
  }
  return rows.length ? { ok: true, rows, sheet } : { ok: false, reason: "empty" };
}

/** RFC-4180-ish CSV: quotes, escaped quotes, commas or semicolons, CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const sep = (src.split("\n")[0]?.split(";").length ?? 0) > (src.split("\n")[0]?.split(",").length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/* ───────────────────────── minimal zip + SpreadsheetML reader ───────────────────────── */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // End of central directory
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/sheet\d+\.xml|_rels\/workbook\.xml\.rels)$/.test(name)) continue;
    const lNameLen = dv.getUint16(local + 26, true), lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + csize);
    out.set(name, method === 8 ? await inflateRaw(raw) : method === 0 ? raw : new Uint8Array());
  }
  return out;
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const textOf = (xml: string) => unescapeXml((xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/^<t[^>]*>/, "").replace(/<\/t>$/, "")).join(""));
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** Reads the first worksheet of an .xlsx into a string grid. Throws when the file is not a spreadsheet. */
export async function xlsxToGrid(buf: ArrayBuffer): Promise<{ grid: string[][]; sheet: string }> {
  const parts = await unzip(buf);
  const dec = new TextDecoder();
  const shared: string[] = [];
  const ss = parts.get("xl/sharedStrings.xml");
  if (ss) for (const si of dec.decode(ss).match(/<si>[\s\S]*?<\/si>/g) ?? []) shared.push(textOf(si));
  // first sheet by workbook order → rels → path
  let sheetPath = "xl/worksheets/sheet1.xml";
  let sheetName = "Sheet1";
  const wb = parts.get("xl/workbook.xml");
  const rels = parts.get("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const first = dec.decode(wb).match(/<sheet\b[^>]*\/?>/)?.[0] ?? "";
    sheetName = first.match(/name="([^"]*)"/)?.[1] ?? sheetName;
    const rid = first.match(/r:id="([^"]*)"/)?.[1];
    const rel = rid ? dec.decode(rels).match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`))?.[0] : null;
    const target = rel?.match(/Target="([^"]*)"/)?.[1];
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = parts.get(sheetPath);
  if (!sheet) throw new Error("no worksheet");
  const xml = dec.decode(sheet);
  const grid: string[][] = [];
  for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const c of rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = c.match(/\br="([A-Z]+)\d+"/)?.[1];
      const t = c.match(/\bt="([^"]*)"/)?.[1];
      let v = "";
      if (t === "s") { const idx = Number(c.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? -1); v = shared[idx] ?? ""; }
      else if (t === "inlineStr") v = textOf(c);
      else v = unescapeXml(c.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      const idx = ref ? colIndex(ref) : cells.length;
      while (cells.length < idx) cells.push("");
      cells[idx] = v;
    }
    grid.push(cells);
  }
  return { grid: grid.filter((r) => r.some((c) => c.trim() !== "")), sheet: sheetName };
}

/** Entry point for the form: CSV or xlsx → rows, or a structured failure for the fallback message. */
export async function parseImportFile(file: File): Promise<ImportResult> {
  try {
    if (/\.xlsx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      const { grid, sheet } = await xlsxToGrid(await file.arrayBuffer());
      return rowsFromGrid(grid, sheet);
    }
    if (/\.(csv|txt|tsv)$/i.test(file.name) || file.type.startsWith("text/")) {
      const text = await file.text();
      return rowsFromGrid(parseCsv(text.includes("\t") && !text.includes(",") ? text.replace(/\t/g, ",") : text), file.name);
    }
    return { ok: false, reason: "unreadable" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
