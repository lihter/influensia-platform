import { requireClientPage } from "@/server/shared/authorize";
import { listClientOrders } from "@/server/client/portal";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { OrdersTable } from "@/components/app/portal/tables";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

/** Orders, newest first: each step as a check mark (deposit · artwork · production · shipping · balance · service fee) + invoice. */
export default async function ClientOrdersPage() {
  const ctx = await requireClientPage("/app/orders");
  const dto = await listClientOrders(ctx);
  const open = dto.rows.filter((r) => r.milestone !== "delivered" && r.exception !== "cancelled").length;
  return (
    <>
      <PageHeader band eyebrow={dto.companyLabel || "Your company"} title="Orders" meta={<span><span className="font-mono">{open}</span> in progress · <span className="font-mono">{dto.rows.length}</span> in total · newest first</span>} />
      <PageBand tone="page" pad="lg"><OrdersTable rows={dto.rows} /></PageBand>
    </>
  );
}
