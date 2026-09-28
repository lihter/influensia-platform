import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("app.notFound");
  return <EmptyState title={t("title")} body={t("body")} action={<Button asChild variant="outline"><Link href="/app">{t("back")}</Link></Button>} />;
}
