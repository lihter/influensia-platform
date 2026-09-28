import { Plus } from "lucide-react";
import { requireOpsPage, isAdmin } from "@/server/shared/authorize";
import { listSuppliers, supplierCities } from "@/server/ops/suppliers";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { SuppliersTable } from "@/components/ops/suppliers/suppliers-table";
import { SupplierForm } from "@/components/ops/suppliers/supplier-form";
import { createSupplierAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suppliers" };

/** F-21 — one record per factory. List with search + filters; "+ Supplier" opens the create sheet. */
export default async function SuppliersPage() {
  const ctx = await requireOpsPage("/ops/suppliers");
  const [rows, cities] = await Promise.all([listSuppliers(ctx), supplierCities(ctx)]);
  return (
    <>
      <PageHeader
        eyebrow="Suppliers"
        title={<>Suppliers <span className="font-mono text-base font-normal text-muted-foreground">{rows.length}</span></>}
        actions={<SupplierForm mode="create" isAdmin={isAdmin(ctx)} onCreate={createSupplierAction} trigger={<Button data-testid="new-supplier"><Plus data-icon="inline-start" />Supplier</Button>} />}
      />
      <SuppliersTable rows={rows} cities={cities} />
    </>
  );
}
