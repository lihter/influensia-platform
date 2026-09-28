import { requireOpsPage, isAdmin } from "@/server/shared/authorize";
import { listSuppliers, supplierCities } from "@/server/ops/suppliers";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { SuppliersTable } from "@/components/ops/suppliers/suppliers-table";
import { SupplierCreateButton } from "@/components/ops/suppliers/supplier-create-button";
import { createSupplierAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suppliers" };

/** F-21 — one record per factory. List with search + filters; "+ Supplier" opens the create sheet. */
export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOpsPage("/ops/suppliers");
  const [rows, cities] = await Promise.all([listSuppliers(ctx), supplierCities(ctx)]);
  return (
    <>
      <PageHeader band
        eyebrow="Suppliers"
        title={<>Suppliers <span className="font-mono text-base font-normal text-muted-foreground">{rows.length}</span></>}
        actions={<SupplierCreateButton isAdmin={isAdmin(ctx)} onCreate={createSupplierAction} defaultOpen={sp.new === "1"} />}
      />
      <PageBand tone="page" pad="md">
        <SuppliersTable rows={rows} cities={cities} />
      </PageBand>
    </>
  );
}
