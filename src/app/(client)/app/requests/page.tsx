import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireClientPage } from "@/server/shared/authorize";
import { listClientRequests } from "@/server/client/requests";
import { ClientListTabDto } from "@/server/client/dto/requests";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { Button } from "@/components/ui/button";
import { RequestsList } from "@/components/app/requests/requests-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests & orders" };

/** F-05 — Requests & orders list. Tab from `?tab=`; everything else (search) is client-side over the DTO. */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireClientPage("/app/requests");
  const { tab: rawTab } = await searchParams;
  const tab = ClientListTabDto.safeParse(rawTab).data ?? "active";
  const [dto, t, tn] = await Promise.all([listClientRequests(ctx), getTranslations("app.requests"), getTranslations("nav.app")]);
  return (
    <>
      <PageHeader
        band
        eyebrow={dto.companyLabel || t("eyebrow")}
        title={t("title")}
        meta={<span>{dto.counts.active} in progress{dto.counts.waiting ? <> · <span className="font-medium text-green-700">{dto.counts.waiting} waiting on you</span></> : null}</span>}
        actions={<Button asChild size="lg" className="w-full md:hidden"><Link href="/app/requests/new"><Plus data-icon="inline-start" />{tn("newRequest")}</Link></Button>}
      />
      <PageBand tone="page" pad="lg"><RequestsList dto={dto} tab={tab} /></PageBand>
    </>
  );
}
