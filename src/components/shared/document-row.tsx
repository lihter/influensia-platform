import { useTranslations } from "next-intl";
import { FileText, ClipboardCheck, Ship, Image as ImageIcon, Award, Table2, File, Download, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DocumentKind, Visibility } from "@/db/enums";
import { VisibilityBadge } from "./chips";
import { DateTime } from "./formatters";

const ICON: Partial<Record<DocumentKind, LucideIcon>> = {
  pi: FileText, invoice: FileText, qc_report: ClipboardCheck, bill_of_lading: Ship, packing_list: Ship, artwork: ImageIcon, dieline: ImageIcon,
  reference_image: ImageIcon, production_photo: ImageIcon, sample_photo: ImageIcon, certificate: Award, price_list: Table2, catalogue: Table2,
  comparison: Table2, quote_file: Table2, rfq: FileText, factory_range_pdf: FileText, other: File,
};

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * DESIGN §5.11 — sheet-list row for a document. Client rows show Download only; ops rows get `actions` (Publish etc.).
 */
export function DocumentRow({ name, kind, bytes, at, visibility, href, actions, className }: {
  name: string; kind: DocumentKind; bytes?: number; at?: Date | string | null; visibility: Visibility; href?: string; actions?: React.ReactNode; className?: string;
}) {
  const t = useTranslations("document_kind");
  const tc = useTranslations("common");
  const Icon = ICON[kind] ?? File;
  return (
    <li className={cn("sheet-row group flex items-center gap-3", className)} data-testid="document-row" data-kind={kind} data-visibility={visibility}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-section-alt"><Icon className="size-4 text-ink-2" strokeWidth={1.75} /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground" title={name}>{name}</p>
        <p className="text-xs text-muted-foreground">
          {t(kind)}{bytes !== undefined && <> · <span className="font-mono">{formatBytes(bytes)}</span></>}{at && <> · <DateTime value={at} variant="short" /></>}
        </p>
      </div>
      <VisibilityBadge visibility={visibility} />
      <div className="flex items-center gap-1">
        {href && <Button asChild variant="ghost" size="icon-sm" aria-label={tc("download")}><a href={href} download><Download /></a></Button>}
        {actions}
      </div>
    </li>
  );
}
