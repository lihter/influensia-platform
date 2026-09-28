"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, X, Loader2, Upload, Trash2, EyeOff, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { OpsOrderDetail } from "@/server/ops/orders";
import type { OpsDocumentRow } from "@/server/ops/documents";
import { DOCUMENT_KINDS, INTERNAL_ONLY_DOCUMENT_KINDS, type DocumentKind } from "@/db/enums";
import { FormShell } from "@/components/shared/form-shell";
import { DocumentRow } from "@/components/shared/document-row";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { uploadOrderDocumentAction, publishDocumentAction, previewPublishAction, unpublishDocumentAction, deleteDocumentAction } from "@/app/(ops)/ops/orders/actions";
import { OrderSection, useAct, SelectField, FileField, fd } from "../ui";
import { ERRORS } from "../strings";
import { cn } from "@/lib/utils";
import { label } from "@/lib/labels";

type Preview = Awaited<ReturnType<typeof previewPublishAction>>;

/** 07 Documents — union of order + line + sample documents, visibility badges, upload (internal), Publish → leak-check dialog, Unpublish, Delete. */
export function DocumentsSection({ d }: { d: OpsOrderDetail }) {
  const tk = useTranslations("document_kind");
  const o = d.order;
  const groups = new Map<DocumentKind, OpsDocumentRow[]>();
  for (const doc of d.documents) groups.set(doc.kind, [...(groups.get(doc.kind) ?? []), doc]);
  const grouped = d.documents.length > 6;
  const internalCount = d.documents.filter((x) => x.visibility === "internal" && x.publishable).length;
  const render = (docs: OpsDocumentRow[]) => (
    <ul className="sheet bg-card">
      {docs.map((doc) => (
        <DocumentRow key={doc.id} name={doc.filename} kind={doc.kind} bytes={doc.bytes} at={doc.uploadedAt} visibility={doc.visibility} href={doc.downloadUrl}
          actions={<DocActions doc={doc} orderId={o.id} orderRef={o.ref} />} className={cn(doc.entityType !== "order" && "[&_p:last-child]:after:content-['_·_'] ")} />
      ))}
    </ul>
  );
  return (
    <OrderSection id="documents" number={7} title="Documents" count={internalCount} action={<UploadSheet orderId={o.id} orderRef={o.ref} />}>
      {d.documents.length === 0 ? <p className="text-sm text-muted-foreground">No documents yet.</p>
        : grouped ? (
          <div className="flex flex-col gap-4">
            {[...groups.entries()].map(([kind, docs]) => (
              <div key={kind}>
                <div className="mb-1.5 eyebrow">{tk(kind)} <span className="font-mono">{docs.length}</span></div>
                {render(docs)}
              </div>
            ))}
          </div>
        ) : render(d.documents)}
      <p className="mt-2 text-xs text-muted-foreground">Quote files, price lists, catalogues, comparisons and RFQs can never be published. Line and sample documents are listed here too (entity in the row meta).</p>
    </OrderSection>
  );
}

function DocActions({ doc, orderId, orderRef }: { doc: OpsDocumentRow; orderId: string; orderRef: string }) {
  const { act, pending } = useAct();
  return (
    <span className="inline-flex items-center gap-1">
      <span className="hidden font-mono text-2xs text-muted-foreground sm:inline" title="Attached to">{doc.entityLabel}</span>
      {doc.visibility === "internal" && doc.publishable && <PublishDialog doc={doc} orderId={orderId} orderRef={orderRef} />}
      {doc.visibility === "client" && (
        <Button size="sm" variant="ghost" disabled={pending} data-testid="unpublish" onClick={() => act(() => unpublishDocumentAction({ orderId, documentId: doc.id }), { success: "Unpublished" })}><EyeOff />Unpublish</Button>
      )}
      <Button size="icon-sm" variant="ghost" aria-label="Delete" disabled={pending} className="text-muted-foreground" onClick={() => { if (confirm(`Delete ${doc.filename}?`)) void act(() => deleteDocumentAction({ orderId, documentId: doc.id }), { success: "Deleted" }); }}><Trash2 /></Button>
    </span>
  );
}

/** Suggested clean filename: drop every blocked match, fall back to `<ORD>-<kind>.<ext>`. */
function cleanName(filename: string, matches: string[], orderRef: string, kind: string) {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot) : "";
  let base = dot > 0 ? filename.slice(0, dot) : filename;
  for (const m of matches) base = base.split(m).join("").replace(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "");
  base = base.replace(/[-_\s.]{2,}/g, "-").replace(/^[-_\s.]+|[-_\s.]+$/g, "");
  return `${base.length >= 3 ? base : `${orderRef}-${kind.replace(/_/g, "-")}`}${ext}`;
}

/**
 * DESIGN §5.16 — Publish to client: Filenames · Text · PDF text layer rows with ✓/✗, matches in mono danger wash.
 * Blocked is never a dead end (UX top list): filename hits get an inline "Rename to" field, text hits an "Upload a
 * redacted copy" picker; "Replace & check again" swaps the file (upload new → delete old) and re-runs the check, and
 * "Check again" re-runs it as-is. Green Publish appears only when the check is clean.
 */
function PublishDialog({ doc, orderId, orderRef }: { doc: OpsDocumentRow; orderId: string; orderRef: string }) {
  const tk = useTranslations("document_kind");
  const [open, setOpen] = React.useState(false);
  const [target, setTarget] = React.useState<{ id: string; filename: string }>({ id: doc.id, filename: doc.filename });
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [hits, setHits] = React.useState<{ kind: string; match: string; where: string }[] | null>(null);
  const [rename, setRename] = React.useState("");
  const [redacted, setRedacted] = React.useState<File | null>(null);
  const [fixing, setFixing] = React.useState(false);
  const [fixError, setFixError] = React.useState<string | null>(null);
  const { act, pending } = useAct();
  const router = useRouter();
  const check = (id: string) => { setPreview(null); setHits(null); void previewPublishAction({ documentId: id }).then(setPreview); };
  const openDialog = () => { setOpen(true); setTarget({ id: doc.id, filename: doc.filename }); setRename(""); setRedacted(null); setFixError(null); check(doc.id); };
  const result = hits ? { ok: false as const, hits } : preview && preview.ok ? preview.data.result : null;
  const rows = [
    { key: "filename", label: "Filename", where: ["filename"] },
    { key: "text", label: "Text", where: ["text"] },
    { key: "pdf_text", label: "PDF text layer", where: ["pdf_text"] },
  ];
  const blocked = !!result && !result.ok;
  const nameHits = blocked ? result.hits.filter((h) => h.where === "filename") : [];
  const textHits = blocked ? result.hits.filter((h) => h.where !== "filename") : [];
  const canReplace = doc.entityType === "order";
  const suggested = nameHits.length ? cleanName(target.filename, nameHits.map((h) => h.match), orderRef, doc.kind) : target.filename;
  const newName = (rename || suggested).trim();
  const ready = canReplace && ((textHits.length > 0 && !!redacted) || (textHits.length === 0 && nameHits.length > 0 && newName.length > 2 && newName !== target.filename));

  const replace = async () => {
    setFixing(true); setFixError(null);
    try {
      let file: File;
      if (redacted) file = new File([redacted], nameHits.length ? newName : redacted.name, { type: redacted.type });
      else {
        const res = await fetch(doc.downloadUrl);
        if (!res.ok) throw new Error("Could not read the original file");
        const blob = await res.blob();
        file = new File([blob], newName, { type: blob.type || "application/octet-stream" });
      }
      const f = new FormData(); f.set("orderId", orderId); f.set("kind", doc.kind); f.set("file", file);
      const up = await uploadOrderDocumentAction(f);
      if (!up.ok) throw new Error(ERRORS[up.error] ?? up.error);
      await deleteDocumentAction({ orderId, documentId: target.id });
      setTarget({ id: up.data.documentId, filename: file.name }); setRename(""); setRedacted(null);
      check(up.data.documentId);
    } catch (e) { setFixError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setFixing(false); }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={openDialog} data-testid="publish">Publish to client</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o && target.id !== doc.id) router.refresh(); }}>
        <DialogContent className="sm:max-w-lg" data-testid="publish-dialog">
          <DialogHeader>
            <DialogTitle>Publish to client</DialogTitle>
            <DialogDescription><span className="font-medium break-all text-foreground">{target.filename}</span> · {tk(doc.kind)} · attached to <span className="font-mono">{doc.entityLabel}</span></DialogDescription>
          </DialogHeader>
          {!result ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{preview && !preview.ok ? ERRORS[preview.error] ?? preview.error : "Running the leak check…"}</p>
          ) : (
            <ul className="sheet" data-testid="leak-check-result">
              {rows.map((r) => {
                const rowHits = result.ok ? [] : result.hits.filter((h) => r.where.includes(h.where));
                const ok = rowHits.length === 0;
                return (
                  <li key={r.key} className="sheet-row flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      {ok ? <Check className="size-4 text-success" /> : <X className="size-4 text-danger" />}
                      <span className={cn("font-medium", ok ? "text-foreground" : "text-danger")}>{r.label}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{ok ? (r.key === "pdf_text" && preview?.ok && !preview.data.hasText ? "No text layer" : "No supplier identifiers found") : `${rowHits.length} ${rowHits.length > 1 ? "matches" : "match"}`}</span>
                    </div>
                    {rowHits.map((h, i) => <code key={i} className="rounded-md bg-danger-wash px-2 py-1 font-mono text-xs break-all text-danger">{h.kind}: {h.match}</code>)}
                    {!ok && canReplace && r.key === "filename" && (
                      <label className="mt-1 flex flex-col gap-1 text-xs text-ink-2" data-testid="fix-rename">
                        Rename to
                        <Input value={rename || suggested} onChange={(e) => setRename(e.target.value)} className="h-8 font-mono text-xs" aria-label="New filename" />
                      </label>
                    )}
                    {!ok && canReplace && r.key !== "filename" && (
                      <label className="mt-1 flex flex-col gap-1 text-xs text-ink-2" data-testid="fix-redact">
                        Upload a redacted copy (the names above removed)
                        <Input type="file" onChange={(e) => setRedacted(e.target.files?.[0] ?? null)} className="h-8 pt-1 text-xs" aria-label="Redacted copy" />
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {blocked && !canReplace && <p className="text-xs text-muted-foreground">This file is attached to <span className="font-mono">{doc.entityLabel}</span>. Replace it there with a clean copy, then check again.</p>}
          {fixError && <p className="text-xs text-danger">{fixError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            {blocked ? (
              ready ? (
                <Button onClick={replace} disabled={fixing} data-testid="publish-blocked">{fixing && <Loader2 className="animate-spin" />}Replace &amp; check again</Button>
              ) : (
                <Button variant="outline" onClick={() => check(target.id)} disabled={fixing} data-testid="publish-blocked"><RotateCcw />Check again</Button>
              )
            ) : (
              <Button variant="green" disabled={!result || pending} data-testid="publish-confirm" onClick={() => act(() => publishDocumentAction({ orderId, documentId: target.id }), { success: "Published to client", onSuccess: () => setOpen(false), onError: (r) => { if (r.hits) setHits(r.hits); } })}>
                {pending && <Loader2 className="animate-spin" />}Publish
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UploadSheet({ orderId, orderRef }: { orderId: string; orderRef: string }) {
  const { act } = useAct();
  const kinds = DOCUMENT_KINDS.filter((k) => !["reference_image", "sample_photo", "factory_range_pdf", "artwork"].includes(k));
  return (
    <FormShell trigger={<Button size="sm" variant="outline" data-testid="upload-document"><Upload />Upload document</Button>} eyebrow={orderRef} title="Upload document" description="Stored internal. Publish it from the list when it is ready for the client." submitLabel="Upload"
      onSubmit={async (e) => { const f = fd(e); f.set("orderId", orderId); return act(() => uploadOrderDocumentAction(f), { success: "Uploaded (internal)" }); }}>
      <SelectField name="kind" label="Kind" defaultValue="other" options={kinds.map((k) => ({ value: k, label: `${label("documentKind", k)}${INTERNAL_ONLY_DOCUMENT_KINDS.includes(k) ? " (never published)" : ""}` }))} />
      <FileField label="File" required hint="PDF, images, xlsx, txt — up to 25 MB." />
    </FormShell>
  );
}
