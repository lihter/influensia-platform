import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requireClientPage, NotFound } from "@/server/shared/authorize";
import { getRange } from "@/server/client/ranges";
import { PageHeader } from "@/components/shared/page-header";
import { FactoryLabel } from "@/components/shared/factory-label";
import { DateTime } from "@/components/shared/formatters";
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
        eyebrow={<Link href="/app/catalog" className="link inline-flex items-center gap-1 normal-case tracking-normal"><ArrowLeft className="size-3" />Catalog</Link>}
        title="More from this factory"
        meta={<><FactoryLabel label={r.factoryLabel} /><span>— {making}</span>{r.orderRefs.length > 0 && <span className="font-mono text-xs">{r.orderRefs.map((o) => <Link key={o} href={`/app/orders/${o}`} className="link mr-2">{o}</Link>)}</span>}<span className="text-xs text-muted-foreground">published <DateTime value={r.publishedAt} /></span></>}
        actions={r.pdf ? <Button asChild variant="outline"><a href={r.pdf.downloadUrl} data-testid="range-pdf"><Download data-icon="inline-start" />Range PDF <span className="font-mono text-xs text-muted-foreground">{formatBytes(r.pdf.bytes)}</span></a></Button> : undefined}
      />
      <p className="mb-4 text-sm text-ink-2">Pick the items you want and a quantity. Prices are indicative — we confirm them with the factory and send you an offer, without a new sourcing round.</p>
      <RangeItems range={r} action={requestRangeItemsAction} />
    </>
  );
}
