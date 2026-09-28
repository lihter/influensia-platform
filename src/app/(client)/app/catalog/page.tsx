import { getTranslations } from "next-intl/server";
import { requireClientPage } from "@/server/shared/authorize";
import { listCatalog } from "@/server/client/catalog";
import { listRanges } from "@/server/client/ranges";
import { PageHeader } from "@/components/shared/page-header";
import { CatalogGrid } from "@/components/app/catalog/catalog-grid";
import { requestOfferAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Catalog" };

/** F-11 — published products with an all-in reference price; D-15 ranges from the client's own factories below. Client DTOs only. */
export default async function CatalogPage() {
  const ctx = await requireClientPage("/app/catalog");
  const [{ products, categories }, ranges, t] = await Promise.all([listCatalog(ctx), listRanges(ctx), getTranslations("app.catalog")]);
  return (
    <>
      <PageHeader band eyebrow={t("eyebrow")} title={t("title")} meta={<span>Reference prices are all-in per unit at the stated quantity. Ask for an offer and we confirm the price for yours.</span>} />
      <CatalogGrid products={products} categories={categories} ranges={ranges} action={requestOfferAction} />
    </>
  );
}
