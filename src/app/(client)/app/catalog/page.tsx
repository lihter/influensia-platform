import { getTranslations } from "next-intl/server";
import { requireClientPage } from "@/server/shared/authorize";
import { listCatalog } from "@/server/client/catalog";
import { PageHeader } from "@/components/shared/page-header";
import { CatalogGrid } from "@/components/app/catalog/catalog-grid";
import { requestOfferAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggestions" };

/** F-11 — published products with an all-in reference price; D-15 ranges from the client's own factories below. Client DTOs only. */
export default async function CatalogPage() {
  const ctx = await requireClientPage("/app/catalog");
  const [{ products, categories }, t] = await Promise.all([listCatalog(ctx), getTranslations("app.catalog")]);
  return (
    <>
      <PageHeader band eyebrow={t("eyebrow")} title={t("title")} meta={<span>Products we recommend and can source for you. Reference prices are all-in per unit at the stated quantity — ask for an offer and we confirm the price for yours.</span>} />
      <CatalogGrid products={products} categories={categories} action={requestOfferAction} />
    </>
  );
}
