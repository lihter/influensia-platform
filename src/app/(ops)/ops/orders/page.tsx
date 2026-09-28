import Link from "next/link";
import { Plus } from "lucide-react";
import { requireOpsPage } from "@/server/shared/authorize";
import { listOrders } from "@/server/ops/orders";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { Button } from "@/components/ui/button";
import { OrdersTable } from "@/components/ops/orders/orders-table";
import { listAcceptedForOrder } from "@/components/ops/orders/accepted-lines";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

/** F-22 — all orders across client orgs: ref · client · lines · state · milestone · due / paid · ETA · agent · stale. */
export default async function OpsOrdersPage() {
  const ctx = await requireOpsPage("/ops/orders");
  const [rows, picks] = await Promise.all([listOrders(ctx), listAcceptedForOrder(ctx)]);
  const acceptedLines = picks.reduce((n, p) => n + p.lines.length, 0);
  return (
    <>
      <PageHeader band
        eyebrow="Orders"
        title={<>Orders <span className="font-mono text-base font-normal text-muted-foreground">{rows.length}</span></>}
        actions={acceptedLines > 0
          ? <Button asChild variant="outline"><Link href="/ops/orders/new"><Plus data-icon="inline-start" />Confirm order <span className="font-mono text-xs text-muted-foreground">{acceptedLines}</span></Link></Button>
          : <span title="No accepted offers to confirm yet" className="inline-flex"><Button variant="outline" disabled><Plus data-icon="inline-start" />Confirm order</Button></span>}
      />
      <PageBand tone="page" pad="md">
        <OrdersTable rows={rows} />
      </PageBand>
    </>
  );
}
