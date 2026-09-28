"use client";
import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link as LinkIcon, Image as ImageIcon, X, Loader2, ChevronDown, ChevronUp, AlertCircle, FileText, Upload, Check, Paperclip } from "lucide-react";
import type { ActionResult } from "@/server/shared/http";
import type { ClientRequestCreatedDto } from "@/server/client/dto/requests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Eyebrow } from "@/components/shared/eyebrow";
import { cn } from "@/lib/utils";
import { extractUrls, parseLink, titleFromFilename } from "./link-parse";
import { parseImportFile } from "./import-parse";
import { S } from "./strings";

const T = S.newRequest;
const MAX_LINES = 50;
const MAX_IMAGES = 10;
const IMAGE_TYPES = /^image\/(jpeg|png|webp)$/;
const IMPORT_TYPES = /\.(csv|xlsx|tsv|txt)$/i;

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

  // enabled as soon as there is a line so a click can point at the missing quantities (AC-NEW-02)
  const canSend = rows.length > 0 && (mode === "client" || !!orgId);

  function submit(draft: boolean) {
    // commit whatever is still in the paste area, then validate against the combined list
    const urls = extractUrls(text);
    const extra = urls.filter((u) => !rows.some((r) => r.url === u)).map((u) => { const p = parseLink(u)!; return blankRow({ kind: "link", url: p.url, domain: p.domain, notDurable: p.notDurable, name: p.title }); });
    const cur = [...rows, ...extra].slice(0, MAX_LINES);
    if (extra.length) setRows(cur);
    setText("");
    run(cur, draft);
  }

  function run(cur: Row[], draft: boolean) {
    // validate against the latest rows
    const e: typeof errors = {};
    for (const r of cur) {
      const qty = r.qty.trim();
      if (!/^\d+$/.test(qty) || Number(qty) < 1) e[r.key] = { ...e[r.key], qty: T.qtyError };
      if (r.name.trim().length < 2 || r.name.trim().length > 200) e[r.key] = { ...e[r.key], name: T.nameError };
    }
    setErrors(e);
    if (!cur.length) { setFormError(T.noLines); return; }
    if (cur.length > MAX_LINES) { setFormError(T.tooManyLines); return; }
    if (mode === "ops" && !orgId) { setFormError(T.opsClientError); return; }
    if (Object.keys(e).length) { setFormError(null); return; }
    setFormError(null);
    const fd = new FormData();
    const payload = {
      lines: cur.map((r) => ({
        name: r.name.trim(), qty: Number(r.qty), unit: r.unit || "pcs", links: r.url ? [r.url] : [], note: r.note.trim() || null, clientSku: r.clientSku.trim() || null,
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
          msg = Object.keys(next).length ? T.qtyError : Object.values(r.errors)[0] ?? T.error;
          setFormError(Object.keys(next).length ? null : msg);
        } else { msg = r.error === "E_FORBIDDEN" ? "You are not allowed to do that." : T.error; setFormError(msg); }
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
      <Button type="button" variant="outline" size="lg" disabled={pending || rows.length === 0} onClick={() => submit(true)} data-testid="save-draft">
        {pending && submitting === "draft" && <Loader2 className="animate-spin" />}{T.saveDraft}
      </Button>
      <Button type="button" size="lg" disabled={pending || !canSend} onClick={() => submit(false)} data-testid="send-request">
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
              <Input id="wad" type="date" className="h-8 w-44" value={whatsappDate} onChange={(e) => setWhatsappDate(e.target.value)} />
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
            className={cn("relative min-h-[140px] rounded-xl border border-dashed bg-card p-6 text-center transition-colors", dragging ? "border-green-600 bg-green-50" : "border-input")}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); const t = e.dataTransfer.getData("text"); if (t) commitText(t + "\n", true); }}
            onClick={() => textareaRef.current?.focus()}
            data-testid="drop-zone"
          >
            <div className="pointer-events-none flex flex-col items-center gap-1.5" aria-hidden={text.length > 0}>
              <div className="flex items-center gap-2 text-muted-foreground"><LinkIcon className="size-5" strokeWidth={1.75} /><ImageIcon className="size-5" strokeWidth={1.75} /></div>
              <p className={cn("text-[15px] font-medium text-foreground", text && "sr-only")}>{T.dropTitle}</p>
              <p className={cn("text-sm text-muted-foreground", text && "sr-only")}>{T.dropHint}</p>
            </div>
            <textarea
              ref={textareaRef}
              aria-label={T.dropTitle}
              placeholder={text ? "" : T.dropHint}
              className="absolute inset-0 size-full resize-none rounded-xl bg-transparent px-6 py-6 font-mono text-sm text-transparent caret-foreground outline-none placeholder:text-transparent focus-visible:ring-2 focus-visible:ring-ring [&:not(:placeholder-shown)]:bg-card [&:not(:placeholder-shown)]:text-foreground"
              value={text}
              onChange={(e) => commitText(e.target.value, false)}
              onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t) { e.preventDefault(); commitText(text + t + "\n", true); } }}
              onBlur={() => commitText(text, true)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitText(text, true); } }}
              data-testid="paste-area"
            />
            <div className="relative mt-3 flex justify-center">
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
              return (
                <li key={r.key} className="sheet-row flex flex-col gap-3 animate-in fade-in duration-[120ms]" data-testid="line-row">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-section-alt text-muted-foreground">
                      {r.previews[0] ? <Image src={r.previews[0]} alt="" width={40} height={40} unoptimized className="size-10 object-cover" /> : r.kind === "file" || r.kind === "text" ? <FileText className="size-4" /> : r.url ? <LinkIcon className="size-4" /> : <ImageIcon className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{String(i + 1).padStart(2, "0")}</span>
                        {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="block max-w-full truncate font-mono hover:underline" title={r.url}>{r.domain}{r.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 60)}</a> : <span>{r.kind === "file" ? T.file : r.kind === "text" ? T.imported : T.photo}{r.files[0] ? ` · ${r.files[0].name}` : ""}</span>}
                        {r.notDurable && <span className="inline-flex items-center gap-1 text-warning" title={T.linkMayExpire}><AlertCircle className="size-3" />{T.linkMayExpire}</span>}
                        {r.files.length > 1 && <span>· {r.files.length} photos</span>}
                      </div>
                      <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <div>
                          <Input aria-label={T.lineName} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} aria-invalid={!!err?.name} className="h-10 text-sm" data-testid="line-name" />
                          {err?.name && <p className="mt-1 flex items-center gap-1 text-xs text-danger"><AlertCircle className="size-3" />{err.name}</p>}
                        </div>
                        <div>
                          <div className="flex items-center">
                            <Input aria-label={T.lineQty} inputMode="numeric" placeholder="Qty" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} aria-invalid={!!err?.qty} className="h-10 w-28 rounded-r-none text-right font-mono text-sm tabular-nums" data-testid="line-qty" />
                            <Select value={r.unit} onValueChange={(v) => update(r.key, { unit: v })}>
                              <SelectTrigger aria-label="Unit" className="h-10 w-[4.5rem] rounded-l-none border-l-0 bg-card font-mono text-xs" data-size="default"><SelectValue /></SelectTrigger>
                              <SelectContent>{["pcs", "set", "pair", "bag", "pack", "m"].map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          {err?.qty && <p className="mt-1 flex items-center gap-1 text-xs text-danger" data-testid="qty-error"><AlertCircle className="size-3" />{err.qty}</p>}
                        </div>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={T.remove} onClick={() => remove(r.key)} data-testid="remove-line"><X /></Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-[52px]">
                    <button type="button" className="link inline-flex items-center gap-1 text-xs" onClick={() => update(r.key, { more: !r.more })} data-testid="line-more">{r.more ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}{r.more ? T.less : T.more}</button>
                    {r.kind !== "file" && (
                      <label className="link inline-flex cursor-pointer items-center gap-1 text-xs"><ImageIcon className="size-3" />{T.dropPhotos}<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { addPhotosToRow(r.key, e.target.files); e.target.value = ""; }} /></label>
                    )}
                  </div>
                  {r.more && (
                    <div className="grid gap-3 pl-[52px] sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <Label htmlFor={`note-${r.key}`}>{T.lineNote}</Label>
                        <Textarea id={`note-${r.key}`} rows={2} maxLength={2000} value={r.note} onChange={(e) => update(r.key, { note: e.target.value })} placeholder={T.lineNotePlaceholder} />
                      </div>
                      <div className="flex flex-col gap-1.5"><Label htmlFor={`sku-${r.key}`}>{T.clientSku}</Label><Input id={`sku-${r.key}`} value={r.clientSku} onChange={(e) => update(r.key, { clientSku: e.target.value })} className="font-mono text-sm" /></div>
                      <div className="flex flex-col gap-1.5"><Label htmlFor={`td-${r.key}`}>{T.targetDelivery}</Label><Input id={`td-${r.key}`} type="date" value={r.targetDelivery} onChange={(e) => update(r.key, { targetDelivery: e.target.value })} /></div>
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
                    <div className="flex flex-wrap gap-1.5 pl-[52px]">{r.previews.map((p) => <Image key={p} src={p} alt="" width={48} height={48} unoptimized className="size-12 rounded-sm object-cover" />)}</div>
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
        <button type="button" className="link inline-flex items-center gap-1 text-sm" onClick={() => setShowRequestMore((v) => !v)}>{showRequestMore ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}{showRequestMore ? T.less : T.more}</button>
        {showRequestMore && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="req-td">{T.requestDelivery}</Label><Input id="req-td" type="date" value={targetDelivery} onChange={(e) => setTargetDelivery(e.target.value)} data-testid="target-delivery" /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="req-dest">{T.destination}</Label><Input id="req-dest" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="PL" /></div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="req-inc">{T.incoterm}</Label>
              <Select value={incoterm} onValueChange={setIncoterm}><SelectTrigger id="req-inc" className="w-full bg-card"><SelectValue /></SelectTrigger><SelectContent>{["EXW", "FOB", "CIF", "DDP", "DAP"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
        )}
      </div>

      {formError && <p className="flex items-center gap-1.5 text-sm text-danger" role="alert" data-testid="form-error"><AlertCircle className="size-4" />{formError}</p>}

      <div className="sticky bottom-0 z-10 -mx-4 flex justify-end border-t border-border bg-background/95 p-4 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">{actions}</div>
    </div>
  );
}
