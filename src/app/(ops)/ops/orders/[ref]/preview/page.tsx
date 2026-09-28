import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye } from "lucide-react";
import { requireOpsPage, NotFound } from "@/server/shared/authorize";
import { getOpsOrder } from "@/server/ops/orders";
import { loadClientOrderPage } from "@/server/client/orders";
import { getDbHandle } from "@/server/shared/db-handle";
import { ClientOrderView } from "@/components/app/orders/order-view";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preview as client" };

/** F-10 preview — renders the client order page through the client DTO with a "Viewing as client" banner (SPEC 2.3). */
export default async function OrderPreviewPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const ctx = await requireOpsPage(`/ops/orders/${ref}/preview`);
  let dto;
  try {
    const d = await getOpsOrder(ctx, ref);
    dto = await loadClientOrderPage(await getDbHandle(), d.order.orgId, ref);
  } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return (
    <div className="mx-auto max-w-[72rem]">
      <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-info-border bg-info-wash px-4 py-3 text-sm text-info" data-testid="preview-banner">
        <span className="inline-flex items-center gap-2"><Eye className="size-4" />Viewing as client — {dto.companyLabel}. Everything below went through the client DTO; actions are disabled.</span>
        <Button asChild variant="outline" size="sm"><Link href={`/ops/orders/${ref}`}>Back to ops</Link></Button>
      </div>
      <ClientOrderView dto={dto} preview />
    </div>
  );
}
