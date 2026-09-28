import { getTranslations } from "next-intl/server";
import { Hammer } from "lucide-react";
import { PageHeader } from "./page-header";
import { EmptyState } from "./empty-state";

/** Placeholder for feature screens: page-header pattern + "Coming in this build" so no nav link 404s. */
export async function PlaceholderPage({ ns }: { ns: string }) {
  const t = await getTranslations(ns);
  const tc = await getTranslations("common");
  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} />
      <div className="rounded-xl border border-border bg-card">
        <EmptyState icon={Hammer} title={tc("comingSoon")} body={tc("comingSoonHint")} />
      </div>
    </>
  );
}
