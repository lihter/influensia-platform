import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireClientPage, NotFound } from "@/server/shared/authorize";
import { getRange } from "@/server/client/ranges";
import { PageHeader } from "@/components/shared/page-header";
import { FactoryLabel } from "@/components/shared/factory-label";
import { fmtDate } from "@/lib/format-date";
import { PageBand } from "@/components/shared/section-band";
import { formatBytes } from "@/components/shared/document-row";
import { Button } from "@/components/ui/button";
import { RangeItems } from "@/components/app/catalog/range-items";
import { requestRangeItemsAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "More from this factory" };

/**
 * F-25 / D-15 client side: "Factory F-0042 — the factory making your {product}", the sanitised items, the PDF (client key),
 * "Request these items". Addressed by uuid; other orgs' ranges and unpublished ranges are 404.
 */
export default async function RangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireClientPage(`/app/ranges/${id}`);
  let r;
  try { r = await getRange(ctx, id); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  const making = r.yourProducts.length ? `the factory making your ${r.yourProducts.slice(0, 2).join(" and ")}${r.yourProducts.length > 2 ? ` (+${r.yourProducts.length - 2})` : ""}` : "a factory already working for you";
  return (
    <>
      <PageHeader
        band
        crumbs={r.orderRefs.length === 1 ? [{ href: "/app/requests", label: "Requests" }, { href: `/app/orders/${r.orderRefs[0]}`, label: <span className="font-mono">{r.orderRefs[0]}</span> }, { label: "More from this factory" }] : [{ href: "/app/catalogues", label: "Catalogues" }, { label: r.displayName ?? "Catalogue" }]}
        title={r.displayName ?? "More from this factory"}
        meta={<><FactoryLabel label={r.factoryLabel} /><span>— {making}</span>{r.orderRefs.length > 0 && <span className="font-mono text-xs">{r.orderRefs.map((o) => <Link key={o} href={`/app/orders/${o}`} className="link mr-2">{o}</Link>)}</span>}<span className="text-xs text-muted-foreground">published {fmtDate(r.publishedAt)}</span></>}
        actions={r.pdf ? <Button asChild variant="outline"><a href={r.pdf.downloadUrl} data-testid="range-pdf"><Download data-icon="inline-start" />Full catalogue PDF{r.pdf.bytes >= 10 * 1024 && <span className="font-mono text-xs text-muted-foreground">{formatBytes(r.pdf.bytes)}</span>}</a></Button> : undefined}
      />
      <PageBand tone="page" pad="lg">
        <p className="mb-4 text-sm text-ink-2">Tick the items you want — a quantity box appears, prefilled with the minimum. Prices are indicative: we confirm them with the factory and send you an offer, without a new sourcing round.</p>
        <RangeItems range={r} action={requestRangeItemsAction} />
      </PageBand>
    </>
  );
}
