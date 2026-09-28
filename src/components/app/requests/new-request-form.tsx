"use client";
import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link as LinkIcon, Image as ImageIcon, X, Loader2, ChevronDown, ChevronUp, AlertCircle, FileText, Upload, Check, Paperclip, ExternalLink, Plus } from "lucide-react";
import type { ActionResult } from "@/server/shared/http";
import type { ClientRequestCreatedDto } from "@/server/client/dto/requests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Eyebrow } from "@/components/shared/eyebrow";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";
import { extractUrls, parseLink, titleFromFilename } from "./link-parse";
import { parseImportFile } from "./import-parse";
import { S } from "./strings";
import { platformOf, shortLink, parseQty, groupQty } from "../client-format";

const T = S.newRequest;
const MAX_LINES = 50;
const MAX_IMAGES = 10;
const IMAGE_TYPES = /^image\/(jpeg|png|webp)$/;
const IMPORT_TYPES = /\.(csv|xlsx|tsv|txt)$/i;
/** Same ceiling as the server (QA-13: request_lines.qty is a 32-bit integer). */
const MAX_QTY = 10_000_000;
const PRESETS = [100, 500, 1_000, 5_000];

/** Client-side quantity check with the server's wording (AC-NEW-02, QA-13, QA-34). */
function qtyProblem(raw: string): string | null {
  const n = parseQty(raw);
  if (n === null || n < 1) return T.qtyError;
  if (!Number.isInteger(n)) return "Whole numbers only";
  if (n > MAX_QTY) return "Quantity is too large — contact us for volumes above 10 million";
  return null;
}

type Row = {
  key: string;
  kind: "link" | "photo" | "file" | "text";
  url: string | null;
  domain: string | null;
  notDurable: boolean;
  name: string;
  qty: string;
  unit: string;
  note: string;
  files: File[];
  previews: string[];
  more: boolean;
  targetDelivery: string;
  clientSku: string;
  reorderInterval: "none" | "monthly" | "quarterly" | "yearly";
  volume12m: string;
};

/** Running summary in the send bar: "3 products · 60,000 pcs". */
function summaryText(rows: Row[]): string {
  if (!rows.length) return "Paste a link or add a photo to start.";
  const qtys = rows.map((r) => parseQty(r.qty));
  const units = new Set(rows.map((r) => r.unit));
  const known = qtys.filter((n): n is number => n !== null && Number.isInteger(n) && n > 0);
  const head = `${rows.length} ${rows.length === 1 ? "product" : "products"}`;
  if (known.length < rows.length) return `${head} · ${rows.length - known.length} without a quantity yet`;
  return units.size === 1 ? `${head} · ${groupQty(known.reduce((a, b) => a + b, 0))} ${[...units][0]}` : head;
}

export type NewRequestAction = (fd: FormData) => Promise<ActionResult<ClientRequestCreatedDto>>;
export type ClientOption = { id: string; name: string; country: string | null };

let seq = 0;
const key = () => `r${++seq}-${Date.now().toString(36)}`;
const blankRow = (p: Partial<Row>): Row => ({ key: key(), kind: "link", url: null, domain: null, notDurable: false, name: "", qty: "", unit: "pcs", note: "", files: [], previews: [], more: false, targetDelivery: "", clientSku: "", reorderInterval: "none", volume12m: "", ...p });

/**
 * Paste-and-go intake (SPEC F-04, DESIGN §5.10). The drop zone IS a textarea: paste → rows; drop photos → photo rows;
 * "Import file" → CSV/xlsx rows (with the SPEC fallback that attaches the file instead). `mode="ops"` adds the client
 * picker, "notify client" and the WhatsApp note; the action decides the source.
 */
export function NewRequestForm({ mode, action, clients, defaultDestination, defaultIncoterm }: { mode: "client" | "ops"; action: NewRequestAction; clients?: ClientOption[]; defaultDestination?: string | null; defaultIncoterm?: string | null }) {
  const router = useRouter();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [text, setText] = React.useState("");
  const [note, setNote] = React.useState("");
  const [targetDelivery, setTargetDelivery] = React.useState("");
  const [destination, setDestination] = React.useState(defaultDestination ?? "");
  const [incoterm, setIncoterm] = React.useState(defaultIncoterm ?? "FOB");
  const [showRequestMore, setShowRequestMore] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, { qty?: string; name?: string }>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [submitting, setSubmitting] = React.useState<"send" | "draft" | null>(null);
  const [done, setDone] = React.useState<ClientRequestCreatedDto | null>(null);
  const [importState, setImportState] = React.useState<{ status: "idle" } | { status: "parsing" } | { status: "done"; n: number; sheet: string } | { status: "fail"; file: File } | { status: "attached"; name: string }>({ status: "idle" });
  const [source, setSource] = React.useState<"portal" | "import">("portal");
  // ops
  const [orgId, setOrgId] = React.useState("");
  const [notifyClient, setNotifyClient] = React.useState(false);
  const [whatsapp, setWhatsapp] = React.useState("");
  const [whatsappDate, setWhatsappDate] = React.useState("");
  const fileInput = React.useRef<HTMLInputElement>(null);
  const importInput = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;
  const textRef = React.useRef(text);
  textRef.current = text;
  const pasteTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (pasteTimer.current) clearTimeout(pasteTimer.current); }, []);
  React.useEffect(() => () => { for (const r of rowsRef.current) for (const p of r.previews) URL.revokeObjectURL(p); }, []); // revoke previews on unmount only

  const addRows = React.useCallback((next: Row[]) => {
    setRows((cur) => {
      const seen = new Set(cur.map((r) => r.url).filter(Boolean));
      const fresh = next.filter((r) => !r.url || !seen.has(r.url));
      return [...cur, ...fresh].slice(0, MAX_LINES);
    });
    setFormError(null);
  }, []);

  /** Turns the pasted text into rows. `all` commits the last (possibly unfinished) line too. */
  const commitText = React.useCallback((value: string, all: boolean) => {
    const lines = value.split(/\r?\n/);
    const done = all ? lines : lines.slice(0, -1);
    const rest = all ? "" : lines[lines.length - 1] ?? "";
    const urls = extractUrls(done.join("\n"));
    if (urls.length) addRows(urls.map((u) => { const p = parseLink(u)!; return blankRow({ kind: "link", url: p.url, domain: p.domain, notDurable: p.notDurable, name: p.title }); }));
    setText(urls.length || all ? rest : value);
  }, [addRows]);

  /**
   * QA-02: links become lines while you type/paste — never on blur. A multi-character change (paste, autofill, drop)
   * commits everything at once; a typed URL is committed after a short pause once it looks complete.
   */
  const onPasteAreaChange = (value: string) => {
    if (pasteTimer.current) clearTimeout(pasteTimer.current);
    if (value.length - textRef.current.length > 1) { commitText(value, true); return; }
    commitText(value, false);
    pasteTimer.current = setTimeout(() => {
      const cur = textRef.current;
      const last = (cur.split(/\r?\n/).pop() ?? "").trim();
      if (/^https?:\/\/[^\s/]+\.[^\s]{2,}$/i.test(last)) commitText(cur, true);
    }, 700);
  };

  const addFiles = React.useCallback((files: FileList | File[]) => {
    const list = [...files];
    const images = list.filter((f) => IMAGE_TYPES.test(f.type));
    const imports = list.filter((f) => IMPORT_TYPES.test(f.name) && !IMAGE_TYPES.test(f.type));
    if (images.length) addRows(images.map((f) => blankRow({ kind: "photo", name: titleFromFilename(f.name), files: [f], previews: [URL.createObjectURL(f)] })));
    if (imports[0]) void importFile(imports[0]);
    const rejected = list.length - images.length - imports.length;
    if (rejected > 0) toast.error(`${rejected} file${rejected === 1 ? "" : "s"} skipped — JPG, PNG, WebP, CSV or xlsx only`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRows]);

  async function importFile(file: File) {
    setImportState({ status: "parsing" });
    const r = await parseImportFile(file);
    if (!r.ok) { setImportState({ status: "fail", file }); return; }
    if (r.rows.length > MAX_LINES) { setImportState({ status: "fail", file }); setFormError(T.tooManyLines); return; }
    addRows(r.rows.map((x) => { const p = x.link ? parseLink(x.link) : null; return blankRow({ kind: p ? "link" : "text", url: p?.url ?? null, domain: p?.domain ?? null, notDurable: p?.notDurable ?? false, name: x.name || p?.title || "", qty: x.qty ? String(x.qty) : "", note: x.note ?? "" }); }));
    setSource("import");
    setImportState({ status: "done", n: r.rows.length, sheet: r.sheet });
  }

  function attachImportFallback(file: File) {
    addRows([blankRow({ kind: "file", name: titleFromFilename(file.name), files: [file], qty: "1" })]);
    setSource("import");
    setImportState({ status: "attached", name: file.name });
  }

  const update = (k: string, patch: Partial<Row>) => {
    setRows((cur) => cur.map((r) => (r.key === k ? { ...r, ...patch } : r)));
    if ("qty" in patch || "name" in patch) setErrors((e) => { if (!e[k]) return e; const n = { ...e, [k]: { ...e[k] } }; if ("qty" in patch) delete n[k].qty; if ("name" in patch) delete n[k].name; if (!n[k].qty && !n[k].name) delete n[k]; return n; });
  };
  const remove = (k: string) => setRows((cur) => { const r = cur.find((x) => x.key === k); r?.previews.forEach((p) => URL.revokeObjectURL(p)); return cur.filter((x) => x.key !== k); });
  const addPhotosToRow = (k: string, files: FileList | null) => {
    if (!files) return;
    const imgs = [...files].filter((f) => IMAGE_TYPES.test(f.type));
    setRows((cur) => cur.map((r) => {
      if (r.key !== k) return r;
      const next = [...r.files, ...imgs].slice(0, MAX_IMAGES);
      if (r.files.length + imgs.length > MAX_IMAGES) toast.error(T.tooManyImages);
      return { ...r, files: next, previews: [...r.previews, ...imgs.slice(0, next.length - r.files.length).map((f) => URL.createObjectURL(f))] };
    }));
  };


  function submit(draft: boolean) {
    // commit whatever is still in the paste area, then validate against the combined list
    const urls = extractUrls(text);
    const extra = urls.filter((u) => !rows.some((r) => r.url === u)).map((u) => { const p = parseLink(u)!; return blankRow({ kind: "link", url: p.url, domain: p.domain, notDurable: p.notDurable, name: p.title }); });
    const cur = [...rows, ...extra].slice(0, MAX_LINES);
    if (extra.length) setRows(cur);
    setText("");
    run(cur, draft);
  }

  function focusFirstProblem(key: string, err: { qty?: string; name?: string } | undefined) {
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-row-key="${key}"]`);
      const el = row?.querySelector<HTMLInputElement>(err?.name ? "[data-testid=line-name]" : "[data-testid=line-qty]");
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    });
  }

  function run(cur: Row[], draft: boolean) {
    // validate against the latest rows
    const e: typeof errors = {};
    for (const r of cur) {
      const qp = qtyProblem(r.qty);
      if (qp) e[r.key] = { ...e[r.key], qty: qp };
      if (r.name.trim().length < 2 || r.name.trim().length > 200) e[r.key] = { ...e[r.key], name: T.nameError };
    }
    setErrors(e);
    if (!cur.length) { setFormError(T.noLines); textareaRef.current?.focus(); return; }
    if (cur.length > MAX_LINES) { setFormError(T.tooManyLines); return; }
    if (mode === "ops" && !orgId) { setFormError(T.opsClientError); return; }
    const bad = cur.filter((r) => e[r.key]);
    if (bad.length) {
      setFormError(bad.length === 1 ? "One line needs your attention — see the highlighted field." : `${bad.length} lines need your attention — see the highlighted fields.`);
      focusFirstProblem(bad[0].key, e[bad[0].key]);
      return;
    }
    setFormError(null);
    const fd = new FormData();
    const payload = {
      lines: cur.map((r) => ({
        name: r.name.trim(), qty: parseQty(r.qty) ?? 0, unit: r.unit || "pcs", links: r.url ? [r.url] : [], note: r.note.trim() || null, clientSku: r.clientSku.trim() || null,
        targetDelivery: r.targetDelivery || null, reorderInterval: r.reorderInterval === "none" ? null : r.reorderInterval, volume12m: r.volume12m.trim() ? Number(r.volume12m) : null, fileCount: r.files.length,
      })),
      note: note.trim() || null, targetDelivery: targetDelivery || null, destination: destination.trim() || null, incotermWanted: incoterm || null, draft, source,
    };
    fd.set("payload", JSON.stringify(payload));
    cur.forEach((r, i) => r.files.forEach((f, j) => fd.append(`line-${i}-file-${j}`, f, f.name)));
    if (mode === "ops") { fd.set("orgId", orgId); fd.set("notifyClient", notifyClient ? "1" : "0"); fd.set("whatsapp", whatsapp.trim()); fd.set("whatsappDate", whatsappDate); }
    setSubmitting(draft ? "draft" : "send");
    start(async () => {
      const r = await action(fd);
      setSubmitting(null);
      if (!r.ok) {
        let msg = T.error;
        if (r.errors) {
          const next: typeof errors = {};
          for (const [path, msg] of Object.entries(r.errors)) { const m = path.match(/^lines\.(\d+)\.(qty|name)/); if (m && cur[Number(m[1])]) next[cur[Number(m[1])].key] = { ...next[cur[Number(m[1])].key], [m[2]]: msg }; }
          setErrors(next);
          const firstBad = cur.find((x) => next[x.key]);
          msg = firstBad ? (next[firstBad.key].qty ?? next[firstBad.key].name ?? T.error) : r.message ?? Object.values(r.errors)[0] ?? T.error;
          setFormError(firstBad ? "Please check the highlighted field." : msg);
          if (firstBad) focusFirstProblem(firstBad.key, next[firstBad.key]);
        } else { msg = r.message ?? (r.error === "E_FORBIDDEN" ? "You are not allowed to do that." : T.error); setFormError(msg); }
        toast.error(msg);
        return;
      }
      if (draft) toast.success(T.draftSaved(r.data.ref));
      else if (mode === "ops") toast.success(T.sentTitle(r.data.ref));
      // the client request page toasts "sent" itself (?sent=1)
      setDone(r.data);
      router.push(`${r.data.href}${draft || mode === "ops" ? "" : "?sent=1"}`);
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center" data-testid="request-sent">
        <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg bg-green-100"><Check className="size-5 text-green-700" /></div>
        <Eyebrow className="mb-2">{done.draft ? "Draft saved" : "Request sent"}</Eyebrow>
        <p className="font-mono text-2xl font-medium tracking-[-0.01em] text-foreground">{done.ref}</p>
        {!done.draft && <p className="mx-auto mt-2 max-w-md text-base text-ink-2">{T.sentBody}</p>}
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button asChild size="lg"><Link href={done.href}>{T.viewRequest}</Link></Button>
          <Button asChild variant="outline" size="lg"><Link href={mode === "ops" ? "/ops/requests/new" : "/app/requests/new"} onClick={() => { setDone(null); setRows([]); }}>{T.another}</Link></Button>
        </div>
      </div>
    );
  }

  const actions = (
    <div className="flex items-center gap-2 max-sm:[&>*]:flex-1">
      <Button type="button" variant="outline" size="lg" disabled={pending} onClick={() => submit(true)} data-testid="save-draft">
        {pending && submitting === "draft" && <Loader2 className="animate-spin" />}{T.saveDraft}
      </Button>
      <Button type="button" size="lg" disabled={pending} onClick={() => submit(false)} data-testid="send-request">
        {pending && submitting === "send" && <Loader2 className="animate-spin" />}{pending && submitting === "send" ? T.sending : T.send}
      </Button>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="new-request-form">
      {mode === "ops" && (
        <div className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org">{T.opsClient}</Label>
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger id="org" className="w-full bg-card" data-testid="org-picker"><SelectValue placeholder={T.opsClientPlaceholder} /></SelectTrigger>
              <SelectContent>{(clients ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.country ? <span className="text-muted-foreground"> · {c.country}</span> : null}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{T.opsSource}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notify" className="flex items-center gap-2 pt-6"><input id="notify" type="checkbox" className="size-4 rounded border-input accent-green-600" checked={notifyClient} onChange={(e) => setNotifyClient(e.target.checked)} data-testid="notify-client" />{T.opsNotify}</Label>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="wa">{T.opsWhatsapp}</Label>
            <Textarea id="wa" rows={2} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder={T.opsWhatsappPlaceholder} data-testid="whatsapp-note" />
            <div className="flex items-center gap-2">
              <Label htmlFor="wad" className="text-xs">{T.opsWhatsappDate}</Label>
              <DateInput id="wad" className="h-8" wrapperClassName="w-44" value={whatsappDate} onChange={(e) => setWhatsappDate(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      <Tabs defaultValue="paste">
        <TabsList>
          <TabsTrigger value="paste"><LinkIcon />{T.tabPaste}</TabsTrigger>
          <TabsTrigger value="import" data-testid="tab-import"><FileText />{T.tabImport}</TabsTrigger>
        </TabsList>
        <TabsContent value="paste" className="pt-4">
          <div
            className={cn("relative rounded-xl border border-dashed bg-card text-center transition-[min-height,background-color] duration-[120ms]", rows.length ? "min-h-14 px-4 py-3" : "min-h-[140px] p-6", dragging ? "border-green-600 bg-green-50" : "border-input")}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); const t = e.dataTransfer.getData("text"); if (t) commitText(t + "\n", true); }}
            onClick={() => textareaRef.current?.focus()}
            data-testid="drop-zone"
            data-compact={rows.length > 0 || undefined}
          >
            {rows.length === 0 ? (
              <div className="pointer-events-none flex flex-col items-center gap-1.5" aria-hidden={text.length > 0}>
                <div className="flex items-center gap-2 text-muted-foreground"><LinkIcon className="size-5" strokeWidth={1.75} /><ImageIcon className="size-5" strokeWidth={1.75} /></div>
                <p className={cn("text-[15px] font-medium text-foreground", text && "sr-only")}>{T.dropTitle}</p>
                <p className={cn("text-sm text-muted-foreground", text && "sr-only")}>{T.dropHint}</p>
              </div>
            ) : (
              <p className={cn("pointer-events-none flex h-8 items-center gap-2 pr-32 text-left text-sm text-muted-foreground", text && "invisible")} aria-hidden><Plus className="size-4" />Paste more links or drop photos</p>
            )}
            <textarea
              ref={textareaRef}
              aria-label={T.dropTitle}
              placeholder={text ? "" : T.dropHint}
              className={cn("absolute inset-0 size-full resize-none rounded-xl bg-transparent font-mono text-sm text-transparent caret-foreground outline-none placeholder:text-transparent focus-visible:ring-2 focus-visible:ring-ring [&:not(:placeholder-shown)]:bg-card [&:not(:placeholder-shown)]:text-foreground", rows.length ? "px-4 py-4 pr-36" : "px-6 py-6")}
              value={text}
              onChange={(e) => onPasteAreaChange(e.target.value)}
              onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t) { e.preventDefault(); commitText(text + t + "\n", true); } }}
              onBlur={() => commitText(text, true)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitText(text, true); } }}
              data-testid="paste-area"
            />
            <div className={cn("relative flex justify-center", rows.length ? "absolute top-1/2 right-3 -translate-y-1/2" : "mt-3")}>
              <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); fileInput.current?.click(); }}><ImageIcon />{T.dropPhotos}</Button>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,.csv,.xlsx" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} data-testid="photo-input" />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="import" className="pt-4">
          <div className="rounded-xl border border-dashed border-input bg-card p-6 text-center">
            <Upload className="mx-auto size-5 text-muted-foreground" strokeWidth={1.75} />
            <p className="mt-2 text-[15px] font-medium">{T.importTitle}</p>
            <p className="text-sm text-muted-foreground">{T.importHint}</p>
            <div className="mt-3">
              <Button type="button" variant="outline" size="sm" disabled={importState.status === "parsing"} onClick={() => importInput.current?.click()} data-testid="import-choose">
                {importState.status === "parsing" ? <Loader2 className="animate-spin" /> : <FileText />}{importState.status === "parsing" ? T.importParsing : T.importChoose}
              </Button>
              <input ref={importInput} type="file" accept=".csv,.xlsx,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} data-testid="import-input" />
            </div>
            {importState.status === "done" && <p className="mt-3 text-sm text-green-700" data-testid="import-done">{T.importDone(importState.n, importState.sheet)}</p>}
            {importState.status === "attached" && <p className="mt-3 text-sm text-green-700" data-testid="import-attached">{T.importAttached(importState.name)}</p>}
            {importState.status === "fail" && (
              <div className="mx-auto mt-4 max-w-md rounded-lg border border-warning-border bg-warning-wash p-4 text-left text-sm" data-testid="import-fallback">
                <p className="flex items-start gap-2 text-foreground"><AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />{T.importFail}</p>
                <Button type="button" size="sm" className="mt-3" onClick={() => attachImportFallback(importState.file)} data-testid="import-attach"><Paperclip />{T.importAttach}</Button>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {rows.length > 0 && (
        <section aria-label={T.linesTitle}>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">{T.linesTitle} <span className="font-mono text-sm font-normal text-muted-foreground">{rows.length}</span></h2>
          </div>
          <ul className="sheet" data-testid="lines">
            {rows.map((r, i) => {
              const err = errors[r.key];
              const platform = r.url ? platformOf(r.url) : null;
              const q = parseQty(r.qty);
              return (
                <li key={r.key} className="sheet-row flex flex-col gap-3 animate-in fade-in duration-[120ms]" data-testid="line-row" data-row-key={r.key}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-mono">{String(i + 1).padStart(2, "0")}</span>
                        {r.previews[0] && <Image src={r.previews[0]} alt="" width={24} height={24} unoptimized className="size-6 rounded-sm object-cover" />}
                        {platform ? (
                          <>
                            <span className={cn("inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-2xs font-semibold", platform.key === "other" ? "bg-section-alt text-ink-2" : "bg-foreground text-background")} data-testid="platform-badge" data-platform={platform.key}>{platform.label}</span>
                            <a href={r.url!} target="_blank" rel="noreferrer" className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono hover:text-foreground hover:underline" title={r.url!}><span className="truncate">{shortLink(r.url!)}</span><ExternalLink className="size-3 shrink-0" /></a>
                          </>
                        ) : <span className="inline-flex items-center gap-1">{r.kind === "file" || r.kind === "text" ? <FileText className="size-3" /> : <ImageIcon className="size-3" />}{r.kind === "file" ? T.file : r.kind === "text" ? T.imported : T.photo}{r.files[0] ? <span className="truncate"> · {r.files[0].name}</span> : ""}</span>}
                        {r.notDurable && <span className="inline-flex items-center gap-1 text-warning" title={T.linkMayExpire}><AlertCircle className="size-3" />{T.linkMayExpire}</span>}
                        {r.files.length > 1 && <span>· {r.files.length} photos</span>}
                      </div>
                      <div className="mt-1.5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="min-w-0">
                          <Input aria-label={T.lineName} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} aria-invalid={!!err?.name} className="h-10 text-sm" data-testid="line-name" />
                          {err?.name && <p className="mt-1 flex items-center gap-1 text-xs text-danger" role="alert"><AlertCircle className="size-3" />{err.name}</p>}
                        </div>
                        <div>
                          <div className="flex items-center">
                            <Input aria-label={T.lineQty} inputMode="numeric" placeholder="Quantity" value={r.qty}
                              onChange={(e) => update(r.key, { qty: e.target.value })}
                              onBlur={(e) => { const n = parseQty(e.target.value); if (n !== null && Number.isInteger(n) && n > 0) update(r.key, { qty: groupQty(n) }); }}
                              aria-invalid={!!err?.qty} className="h-10 w-full rounded-r-none text-right font-mono text-sm tabular-nums sm:w-32" data-testid="line-qty" />
                            <Select value={r.unit} onValueChange={(v) => update(r.key, { unit: v })}>
                              <SelectTrigger aria-label="Unit" className="h-10 w-[4.75rem] shrink-0 rounded-l-none border-l-0 bg-card font-mono text-xs" data-size="default"><SelectValue /></SelectTrigger>
                              <SelectContent>{["pcs", "set", "pair", "bag", "pack", "m"].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          {err?.qty && <p className="mt-1 flex items-center gap-1 text-xs text-danger" data-testid="qty-error" role="alert"><AlertCircle className="size-3" />{err.qty}</p>}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick quantity">
                        {PRESETS.map((n) => (
                          <button key={n} type="button" onClick={() => update(r.key, { qty: groupQty(n) })} aria-pressed={q === n} data-testid="qty-preset"
                            className={cn("h-7 rounded-full border px-2.5 font-mono text-xs transition-colors duration-[120ms]", q === n ? "border-green-600 bg-green-50 text-green-700" : "border-border bg-card text-ink-2 hover:bg-surface-sunken")}>{groupQty(n)}</button>
                        ))}
                        <span className="text-xs text-muted-foreground">or type any quantity</span>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={T.remove} onClick={() => remove(r.key)} data-testid="remove-line"><X /></Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" className="link inline-flex items-center gap-1 text-xs" onClick={() => update(r.key, { more: !r.more })} data-testid="line-more" aria-expanded={r.more}>{r.more ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}{r.more ? "Hide details" : "Details (note, reference, date)"}</button>
                    {r.kind !== "file" && (
                      <label className="link inline-flex cursor-pointer items-center gap-1 text-xs"><ImageIcon className="size-3" />{T.dropPhotos}<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { addPhotosToRow(r.key, e.target.files); e.target.value = ""; }} /></label>
                    )}
                  </div>
                  {r.more && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <Label htmlFor={`note-${r.key}`}>{T.lineNote}</Label>
                        <Textarea id={`note-${r.key}`} rows={2} maxLength={2000} value={r.note} onChange={(e) => update(r.key, { note: e.target.value })} placeholder={T.lineNotePlaceholder} />
                      </div>
                      <div className="flex flex-col gap-1.5"><Label htmlFor={`sku-${r.key}`}>{T.clientSku}</Label><Input id={`sku-${r.key}`} value={r.clientSku} onChange={(e) => update(r.key, { clientSku: e.target.value })} className="font-mono text-sm" /></div>
                      <div className="flex flex-col gap-1.5"><Label htmlFor={`td-${r.key}`}>{T.targetDelivery}</Label><DateInput id={`td-${r.key}`} value={r.targetDelivery} onChange={(e) => update(r.key, { targetDelivery: e.target.value })} /></div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`ri-${r.key}`}>{T.reorder}</Label>
                        <Select value={r.reorderInterval} onValueChange={(v) => update(r.key, { reorderInterval: v as Row["reorderInterval"] })}>
                          <SelectTrigger id={`ri-${r.key}`} className="w-full bg-card"><SelectValue /></SelectTrigger>
                          <SelectContent>{(["none", "monthly", "quarterly", "yearly"] as const).map((v) => <SelectItem key={v} value={v}>{v === "none" ? "One-off" : v[0].toUpperCase() + v.slice(1)}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1.5"><Label htmlFor={`vol-${r.key}`}>{T.volume12m}</Label><Input id={`vol-${r.key}`} inputMode="numeric" value={r.volume12m} onChange={(e) => update(r.key, { volume12m: e.target.value })} className="text-right font-mono text-sm" /></div>
                    </div>
                  )}
                  {r.previews.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">{r.previews.map((pv) => <Image key={pv} src={pv} alt="" width={48} height={48} unoptimized className="size-12 rounded-sm object-cover" />)}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="req-note">{T.note}</Label>
        <Textarea id="req-note" rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={T.notePlaceholder} data-testid="request-note" />
      </div>
      <div>
        <button type="button" className="link inline-flex items-center gap-1 text-sm" onClick={() => setShowRequestMore((v) => !v)} aria-expanded={showRequestMore}>{showRequestMore ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}Delivery &amp; deadline</button>
        {showRequestMore && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="req-td">{T.requestDelivery}</Label><DateInput id="req-td" value={targetDelivery} onChange={(e) => setTargetDelivery(e.target.value)} data-testid="target-delivery" /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="req-dest">{T.destination}</Label><Input id="req-dest" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="PL" /></div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="req-inc">{T.incoterm}</Label>
              <Select value={incoterm} onValueChange={setIncoterm}><SelectTrigger id="req-inc" className="w-full bg-card"><SelectValue /></SelectTrigger><SelectContent>{["EXW", "FOB", "CIF", "DDP", "DAP"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-t-xl sm:px-0" data-testid="send-bar">
        <div className="min-w-0 text-sm">
          {formError ? <p className="flex items-center gap-1.5 text-danger" role="alert" data-testid="form-error"><AlertCircle className="size-4 shrink-0" />{formError}</p>
            : <p className="font-mono text-xs text-ink-2" data-testid="send-summary">{summaryText(rows)}</p>}
        </div>
        {actions}
      </div>
    </div>
  );
}
