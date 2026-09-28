import { Plus } from "lucide-react";
import { requireOpsPage } from "@/server/shared/authorize";
import { listProducts, clientOrgOptions } from "@/server/ops/products";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { Button } from "@/components/ui/button";
import { ProductsTable } from "@/components/ops/products/products-table";
import { ProductCreateForm } from "@/components/ops/products/product-form";
import { createProductAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Products" };

/** F-24 — every product, visibility, reference price, lines/orders count. */
export default async function ProductsPage() {
  const ctx = await requireOpsPage("/ops/products");
  const [rows, owners] = await Promise.all([listProducts(ctx), clientOrgOptions(ctx)]);
  const inCatalog = rows.filter((r) => r.visibility === "catalog").length;
  return (
    <>
      <PageHeader band
        eyebrow="Products"
        title={<>Products <span className="font-mono text-base font-normal text-muted-foreground">{rows.length}</span></>}
        meta={<span className="text-sm text-ink-2"><span className="font-mono">{inCatalog}</span> in the catalog · <span className="font-mono">{rows.filter((r) => r.priceStale || r.priceExpiring).length}</span> reference prices expiring or expired</span>}
        actions={<ProductCreateForm owners={owners} action={createProductAction} trigger={<Button data-testid="new-product"><Plus data-icon="inline-start" />Product</Button>} />}
      />
      <PageBand tone="page" pad="md">
        <ProductsTable rows={rows} owners={owners} />
      </PageBand>
    </>
  );
}
