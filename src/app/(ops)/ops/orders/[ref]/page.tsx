import { notFound } from "next/navigation";
import { requireOpsPage } from "@/server/shared/authorize";
import { getOpsOrder } from "@/server/ops/orders";
import { NotFound } from "@/server/shared/authorize";
import { OpsOrderPage } from "@/components/ops/orders/order-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

/** F-22 / F-23 — the ops order page: header + stepper + 01 Lines … 08 Timeline (DESIGN §6.10). */
export default async function OpsOrderRoute({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const ctx = await requireOpsPage(`/ops/orders/${ref}`);
  let d;
  try { d = await getOpsOrder(ctx, ref); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return <OpsOrderPage d={d} />;
}
