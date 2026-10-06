import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireClientPage } from "@/server/shared/authorize";
import { getClientDashboard } from "@/server/client/dashboard";
import { listClientOrders, listClientProducts } from "@/server/client/portal";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { ClientDashboardView } from "@/components/app/client-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

/** F-03 — "Waiting on you" + active lines by milestone + recent updates. All data via ClientDashboardDto. */
export default async function ClientDashboardPage() {
  const ctx = await requireClientPage();
  const [dto, orders, products, t, tn] = await Promise.all([getClientDashboard(ctx), listClientOrders(ctx), listClientProducts(ctx), getTranslations("app.dashboard"), getTranslations("nav.app")]);
  return (
    <>
      <PageHeader
        band
        className="pb-4"
        eyebrow={dto.companyLabel}
        title={dto.userName ? t("greeting", { name: dto.userName.replace(/\s*\(.*?\)\s*/g, " ").trim().split(/\s+/)[0] }) : "Your requests & orders"}
        meta={<span>Your products, orders and requests — everything we source for you, in one place.</span>}
        actions={<Button asChild size="lg" className="w-full md:hidden"><Link href="/app/requests/new"><Plus data-icon="inline-start" />{tn("newRequest")}</Link></Button>}
      />
      <ClientDashboardView dto={dto} orders={orders.rows} products={products.rows} />
    </>
  );
}
