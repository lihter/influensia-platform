import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOpsPage, NotFound } from "@/server/shared/authorize";
import { getConfirmOrderContext } from "@/server/ops/orders";
import { PageHeader } from "@/components/shared/page-header";
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
    return (
      <>
        <PageHeader eyebrow="Orders" title="Confirm order" />
        <div className="rounded-xl border border-border bg-card"><EmptyState title="Pick a request first" body="Open a request with accepted offers and use “Confirm order”, or add ?req=REQ-2026-0301 to this URL." action={<Button asChild variant="outline"><Link href="/ops/requests">Requests</Link></Button>} /></div>
      </>
    );
  }
  let c;
  try { c = await getConfirmOrderContext(ctx, { lineRef, requestRef }); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return (
    <>
      <PageHeader eyebrow={`${c.requestRef} · ${c.orgName}`} title="Confirm order" titleSuffix={c.orderRef} />
      <NewOrderForm c={c} />
    </>
  );
}
