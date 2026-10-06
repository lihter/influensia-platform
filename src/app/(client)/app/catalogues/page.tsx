import { requireClientPage } from "@/server/shared/authorize";
import { listRanges } from "@/server/client/ranges";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { RangesList } from "@/components/app/catalog/catalog-grid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Catalogues" };

/** Full product catalogues (PDF + items with prices) of the makers already working for this client. Client DTOs only. */
export default async function CataloguesPage() {
  const ctx = await requireClientPage("/app/catalogues");
  const ranges = await listRanges(ctx);
  return (
    <>
      <PageHeader band eyebrow="From Influensia" title="Catalogues" meta={<span>Everything the makers behind your products can supply — open a catalogue to see items, prices and the full PDF, and request a quote in one step.</span>} />
      <PageBand tone="page" pad="lg"><RangesList ranges={ranges} /></PageBand>
    </>
  );
}
