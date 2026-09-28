import Link from "next/link";
import { Plus } from "lucide-react";
import { requireOpsPage } from "@/server/shared/authorize";
import { listRanges } from "@/server/ops/ranges";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { Button } from "@/components/ui/button";
import { RangesTable } from "@/components/ops/products/ranges-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Factory ranges" };

/** F-25 — list: label, supplier (ops), client org, items, published. */
export default async function FactoryRangesPage() {
  const ctx = await requireOpsPage("/ops/factory-ranges");
  const rows = await listRanges(ctx);
  return (
    <>
      <PageHeader band
        eyebrow="Factory ranges"
        title={<>Factory ranges <span className="font-mono text-base font-normal text-muted-foreground">{rows.length}</span></>}
        meta={<span>The sanitised range of one factory, published to one client as “Factory F-nnnn”. Labels come from their own sequence and never correlate with SUP refs.</span>}
        actions={<Button asChild data-testid="new-range"><Link href="/ops/factory-ranges/new"><Plus data-icon="inline-start" />Range</Link></Button>}
      />
      <PageBand tone="page" pad="md">
        <RangesTable rows={rows} />
      </PageBand>
    </>
  );
}
