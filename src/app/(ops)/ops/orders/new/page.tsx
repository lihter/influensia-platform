import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOpsPage, NotFound } from "@/server/shared/authorize";
import { getConfirmOrderContext } from "@/server/ops/orders";
import { PageHeader, EyebrowLink } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { listAcceptedForOrder } from "@/components/ops/orders/accepted-lines";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { NewOrderForm } from "@/components/ops/orders/new-order-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirm order" };

/** F-22 "Confirm order" — reached from a line's offer tab (`?lineId=REQ-…-01`) or a request page (`?req=REQ-…`). */
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ lineId?: string; line?: string; req?: string; requestRef?: string }> }) {
  const ctx = await requireOpsPage("/ops/orders/new");
  const sp = await searchParams;
  const lineRef = sp.lineId ?? sp.line;
  const requestRef = sp.req ?? sp.requestRef;
  if (!lineRef && !requestRef) {
    const picks = await listAcceptedForOrder(ctx);
    return (
      <>
        <PageHeader band crumbs={[{ href: "/ops/orders", label: "Orders" }, { label: "Confirm order" }]} eyebrow="Orders" title="Confirm order" meta={<span>Pick the accepted offer to turn into an order.</span>} />
        <PageBand tone="page" pad="md">
          {picks.length === 0 ? (
            <div className="rounded-xl border border-border bg-card"><EmptyState title="No accepted offers yet" body="An order starts from a line whose offer the client accepted. They will be listed here." action={<Button asChild variant="outline"><Link href="/ops/requests">Go to requests</Link></Button>} /></div>
          ) : (
            <ul className="sheet max-w-[56rem]" data-testid="accepted-picker">
              {picks.map((p) => (
                <li key={p.requestRef}>
                  <Link href={`/ops/orders/new?req=${encodeURIComponent(p.requestRef)}`} className="sheet-row flex items-center gap-4 transition-colors duration-[120ms] hover:bg-surface-sunken">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2"><span className="font-mono text-sm font-medium">{p.requestRef}</span><span className="text-sm text-ink-2">{p.orgName}</span></div>
                      <div className="truncate text-xs text-muted-foreground">{p.lines.map((l) => l.name).join(" · ")}</div>
                    </div>
                    <span className="shrink-0 text-xs text-ink-2"><span className="font-mono">{p.lines.length}</span> accepted {p.lines.length === 1 ? "line" : "lines"}</span>
                    <span className="shrink-0 text-sm font-medium text-link">Confirm →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </PageBand>
      </>
    );
  }
  let c;
  try { c = await getConfirmOrderContext(ctx, { lineRef, requestRef }); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return (
    <>
      <PageHeader band crumbs={[{ href: "/ops/orders", label: "Orders" }, { href: "/ops/orders/new", label: "Confirm order" }, { label: <span className="font-mono">{c.requestRef}</span> }]} eyebrow={<><EyebrowLink href={`/ops/requests/${c.requestRef}`} className="font-mono">{c.requestRef}</EyebrowLink> · <EyebrowLink href={`/ops/clients/${c.orgId}`}>{c.orgName}</EyebrowLink></>} title="Confirm order" titleSuffix={c.orderRef} />
      <PageBand tone="page" pad="md">
        <NewOrderForm c={c} />
      </PageBand>
    </>
  );
}
