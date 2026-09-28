"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import type { ActionResult } from "@/server/shared/http";
import { FormShell } from "@/components/shared/form-shell";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldRow } from "./supplier-form";

/** Upload a price list / catalogue (always Internal; SPEC F-23 says these kinds can never be published). */
export function DocumentUploadForm({ supplierId, supplierRef, trigger, action }: { supplierId: string; supplierRef: string; trigger: React.ReactNode; action: (fd: FormData) => Promise<ActionResult<{ documentId: string }>> }) {
  const router = useRouter();
  const [kind, setKind] = React.useState<"price_list" | "catalogue">("price_list");
  const [file, setFile] = React.useState<File | null>(null);
  const [validUntil, setValidUntil] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <FormShell trigger={trigger} eyebrow={supplierRef} title="Upload price list or catalogue" description="Stored as an internal document. Price lists and catalogues can never be published to a client." submitLabel="Upload"
      onSubmit={async () => {
        setErrors({});
        if (!file) { setErrors({ file: "Choose a file" }); return false; }
        const fd = new FormData();
        fd.set("supplierId", supplierId); fd.set("supplierRef", supplierRef); fd.set("kind", kind); fd.set("file", file); fd.set("validUntil", validUntil); fd.set("currency", currency); fd.set("notes", notes);
        const r = await action(fd);
        if (!r.ok) { setErrors(r.errors ?? { _: r.error }); toast.error(r.errors ? "Check the highlighted fields" : r.error); return false; }
        toast.success(`${kind === "price_list" ? "Price list" : "Catalogue"} uploaded`);
        setFile(null); setNotes(""); setValidUntil("");
        router.refresh();
        return true;
      }}>
      <FieldRow label="Kind" htmlFor="doc-kind">
        <Select value={kind} onValueChange={(x) => setKind(x as typeof kind)}>
          <SelectTrigger id="doc-kind" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="price_list">Price list</SelectItem><SelectItem value="catalogue">Catalogue</SelectItem></SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="File" htmlFor="doc-file" error={errors.file} hint="pdf, xlsx, xls, csv, zip or image · max 25 MB">
        <label htmlFor="doc-file" className="flex min-h-[96px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-input bg-card p-4 text-center text-sm hover:border-green-600 hover:bg-green-50">
          <Upload className="size-5 text-muted-foreground" strokeWidth={1.75} />
          <span className="font-medium">{file ? file.name : "Choose a file"}</span>
          {file && <span className="font-mono text-xs text-muted-foreground">{Math.round(file.size / 1024)} KB</span>}
        </label>
        <input id="doc-file" name="file" type="file" className="sr-only" accept=".pdf,.xlsx,.xls,.csv,.zip,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="doc-file" />
      </FieldRow>
      <div className="grid grid-cols-2 gap-4">
        <FieldRow label="Valid until (optional)" htmlFor="doc-valid"><DateInput id="doc-valid" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></FieldRow>
        <FieldRow label="Currency" htmlFor="doc-cur"><Input id="doc-cur" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className="font-mono" /></FieldRow>
      </div>
      <FieldRow label="Notes (optional)" htmlFor="doc-notes"><Textarea id="doc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></FieldRow>
      {errors._ && <p className="text-xs text-danger" role="alert">{errors._}</p>}
    </FormShell>
  );
}
