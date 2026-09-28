import { getTranslations } from "next-intl/server";
import { requireClientPage } from "@/server/shared/authorize";
import { PageHeader } from "@/components/shared/page-header";
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
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <NewRequestForm mode="client" action={createRequestAction} />
        <NextStepsRail />
      </div>
    </>
  );
}
