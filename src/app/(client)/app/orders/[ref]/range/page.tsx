import { notFound, redirect } from "next/navigation";
import { requireClientPage, NotFound } from "@/server/shared/authorize";
import { rangeIdForOrder } from "@/server/client/ranges";

export const dynamic = "force-dynamic";

/** SPEC 2.2 `/app/orders/[orderRef]/range` — "More from this factory" for this order; the range page itself lives at /app/ranges/[id]. */
export default async function OrderRangePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const ctx = await requireClientPage(`/app/orders/${ref}/range`);
  let id: string;
  try { id = await rangeIdForOrder(ctx, ref); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  redirect(`/app/ranges/${id}`);
}
