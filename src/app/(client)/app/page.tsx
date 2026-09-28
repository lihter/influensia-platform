import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireClientPage } from "@/server/shared/authorize";
import { getClientDashboard } from "@/server/client/dashboard";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { ClientDashboardView } from "@/components/app/client-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

/** F-03 — "Waiting on you" + active lines by milestone + recent updates. All data via ClientDashboardDto. */
export default async function ClientDashboardPage() {
  const ctx = await requireClientPage();
  const [dto, t, tn] = await Promise.all([getClientDashboard(ctx), getTranslations("app.dashboard"), getTranslations("nav.app")]);
  return (
    <>
      <PageHeader
        eyebrow={dto.companyLabel}
        title={t("title")}
        actions={<Button asChild size="lg" className="w-full md:hidden"><Link href="/app/requests/new"><Plus data-icon="inline-start" />{tn("newRequest")}</Link></Button>}
      />
      <ClientDashboardView dto={dto} />
    </>
  );
}
