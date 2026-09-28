"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, X, Loader2, Upload, Trash2, EyeOff } from "lucide-react";
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
    <ul className="sheet">
      {docs.map((doc) => (
        <DocumentRow key={doc.id} name={doc.filename} kind={doc.kind} bytes={doc.bytes} at={doc.uploadedAt} visibility={doc.visibility} href={doc.downloadUrl}
          actions={<DocActions doc={doc} orderId={o.id} />} className={cn(doc.entityType !== "order" && "[&_p:last-child]:after:content-['_·_'] ")} />
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

function DocActions({ doc, orderId }: { doc: OpsDocumentRow; orderId: string }) {
  const { act, pending } = useAct();
  return (
    <span className="inline-flex items-center gap-1">
      <span className="hidden font-mono text-2xs text-muted-foreground sm:inline" title="attached to">{doc.entityLabel}</span>
      {doc.visibility === "internal" && doc.publishable && <PublishDialog doc={doc} orderId={orderId} />}
      {doc.visibility === "client" && (
        <Button size="sm" variant="ghost" disabled={pending} data-testid="unpublish" onClick={() => act(() => unpublishDocumentAction({ orderId, documentId: doc.id }), { success: "Unpublished" })}><EyeOff />Unpublish</Button>
      )}
      <Button size="icon-sm" variant="ghost" aria-label="Delete" disabled={pending} className="text-muted-foreground" onClick={() => { if (confirm(`Delete ${doc.filename}?`)) void act(() => deleteDocumentAction({ orderId, documentId: doc.id }), { success: "Deleted" }); }}><Trash2 /></Button>
    </span>
  );
}

/** DESIGN §5.16 — Publish to client: Filenames · Text · PDF text layer rows with ✓/✗, matches in mono danger wash; green Publish only when clean. */
function PublishDialog({ doc, orderId }: { doc: OpsDocumentRow; orderId: string }) {
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [hits, setHits] = React.useState<{ kind: string; match: string; where: string }[] | null>(null);
  const { act, pending } = useAct();
  const openDialog = () => { setOpen(true); setPreview(null); setHits(null); void previewPublishAction({ documentId: doc.id }).then(setPreview); };
  const result = hits ? { ok: false as const, hits } : preview && preview.ok ? preview.data.result : null;
  const rows = [
    { key: "filename", label: "Filename", where: ["filename"] },
    { key: "text", label: "Text", where: ["text"] },
    { key: "pdf_text", label: "PDF text layer", where: ["pdf_text"] },
  ];
  return (
    <>
      <Button size="sm" variant="outline" onClick={openDialog} data-testid="publish">Publish to client</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="publish-dialog">
          <DialogHeader>
            <DialogTitle>Publish to client</DialogTitle>
            <DialogDescription><span className="font-medium text-foreground">{doc.filename}</span> · {doc.kind.replace(/_/g, " ")} · attached to <span className="font-mono">{doc.entityLabel}</span></DialogDescription>
          </DialogHeader>
          {!result ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{preview && !preview.ok ? ERRORS[preview.error] ?? preview.error : "Running the leak check…"}</p>
          ) : (
            <ul className="sheet" data-testid="leak-check-result">
              {rows.map((r) => {
                const rowHits = result.ok ? [] : result.hits.filter((h) => r.where.includes(h.where));
                const ok = rowHits.length === 0;
                return (
                  <li key={r.key} className="sheet-row flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-sm">
                      {ok ? <Check className="size-4 text-success" /> : <X className="size-4 text-danger" />}
                      <span className={cn("font-medium", ok ? "text-foreground" : "text-danger")}>{r.label}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{ok ? (r.key === "pdf_text" && preview?.ok && !preview.data.hasText ? "no text layer" : "No supplier identifiers found") : `${rowHits.length} match${rowHits.length > 1 ? "es" : ""}`}</span>
                    </div>
                    {rowHits.map((h, i) => <code key={i} className="rounded-md bg-danger-wash px-2 py-1 font-mono text-xs text-danger">{h.kind}: {h.match}</code>)}
                  </li>
                );
              })}
            </ul>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            {result && !result.ok ? (
              <Button disabled data-testid="publish-blocked">Fix and try again</Button>
            ) : (
              <Button variant="green" disabled={!result || pending} data-testid="publish-confirm" onClick={() => act(() => publishDocumentAction({ orderId, documentId: doc.id }), { success: "Published to client", onSuccess: () => setOpen(false), onError: (r) => { if (r.hits) setHits(r.hits); } })}>
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
      <SelectField name="kind" label="Kind" defaultValue="other" options={kinds.map((k) => ({ value: k, label: `${k.replace(/_/g, " ")}${INTERNAL_ONLY_DOCUMENT_KINDS.includes(k) ? " (never published)" : ""}` }))} />
      <FileField label="File" required hint="PDF, images, xlsx, txt — up to 25 MB." />
    </FormShell>
  );
}
