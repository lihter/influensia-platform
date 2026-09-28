import Link from "next/link";
import { Plus } from "lucide-react";
import { requireOpsPage } from "@/server/shared/authorize";
import { listOrders } from "@/server/ops/orders";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { OrdersTable } from "@/components/ops/orders/orders-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

/** F-22 — all orders across client orgs: ref · client · lines · state · milestone · due / paid · ETA · agent · stale. */
export default async function OpsOrdersPage() {
  const ctx = await requireOpsPage("/ops/orders");
  const rows = await listOrders(ctx);
  return (
    <>
      <PageHeader
        eyebrow="Orders"
        title={<>Orders <span className="font-mono text-base font-normal text-muted-foreground">{rows.length}</span></>}
        actions={<Button asChild variant="outline"><Link href="/ops/orders/new"><Plus data-icon="inline-start" />Confirm order</Link></Button>}
      />
      <OrdersTable rows={rows} />
    </>
  );
}
