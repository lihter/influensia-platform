import Link from "next/link";
import { Plus } from "lucide-react";
import { requireClientPage } from "@/server/shared/authorize";
import { listClientProducts } from "@/server/client/portal";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { Button } from "@/components/ui/button";
import { ProductsTable } from "@/components/app/portal/tables";

export const dynamic = "force-dynamic";
export const metadata = { title: "Products" };

/** Every product we source for this client — picture first, then name, status, the client's own price and orders. */
export default async function ClientProductsPage() {
  const ctx = await requireClientPage("/app/products");
  const dto = await listClientProducts(ctx);
  const priced = dto.rows.filter((r) => r.price).length;
  return (
    <>
      <PageHeader
        band
        eyebrow={dto.companyLabel || "Your company"}
        title="Products"
        meta={<span><span className="font-mono">{dto.rows.length}</span> products · <span className="font-mono">{priced}</span> with a price</span>}
        actions={<Button asChild><Link href="/app/requests/new"><Plus data-icon="inline-start" />New request</Link></Button>}
      />
      <PageBand tone="page" pad="lg"><ProductsTable rows={dto.rows} /></PageBand>
    </>
  );
}
