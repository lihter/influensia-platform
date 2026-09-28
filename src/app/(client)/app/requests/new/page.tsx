import { getTranslations } from "next-intl/server";
import { requireClientPage } from "@/server/shared/authorize";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { NewRequestForm } from "@/components/app/requests/new-request-form";
import { NextStepsRail } from "@/components/app/requests/next-steps-rail";
import { createRequestAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New request" };

/** F-04 — paste-and-go intake (DESIGN §6.2): form left, "What happens next" rail right (below the form on phone). */
export default async function NewRequestPage() {
  await requireClientPage("/app/requests/new");
  const t = await getTranslations("app.newRequest");
  return (
    <>
      <PageHeader band eyebrow={t("eyebrow")} title={t("title")} meta={<span>Paste links or drop photos, add quantities, send. Same effort as a message.</span>} />
      <PageBand tone="page" pad="lg">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <NewRequestForm mode="client" action={createRequestAction} />
          <NextStepsRail />
        </div>
      </PageBand>
    </>
  );
}
