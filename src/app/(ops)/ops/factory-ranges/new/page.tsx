import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireOpsPage } from "@/server/shared/authorize";
import { supplierOptions } from "@/server/ops/suppliers";
import { clientOrgOptions } from "@/server/ops/products";
import { PageHeader } from "@/components/shared/page-header";
import { RangeNewForm } from "@/components/ops/products/range-new-form";
import { createRangeAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New factory range" };

export default async function NewRangePage({ searchParams }: { searchParams: Promise<{ supplier?: string; org?: string }> }) {
  const ctx = await requireOpsPage("/ops/factory-ranges/new");
  const [{ supplier, org }, suppliers, orgs] = await Promise.all([searchParams, supplierOptions(ctx), clientOrgOptions(ctx)]);
  return (
    <>
      <PageHeader eyebrow={<Link href="/ops/factory-ranges" className="link inline-flex items-center gap-1 normal-case tracking-normal"><ArrowLeft className="size-3" />Factory ranges</Link>} title="New factory range" />
      <RangeNewForm suppliers={suppliers} orgs={orgs} presetSupplierId={supplier} presetOrgId={org} action={createRangeAction} />
    </>
  );
}
