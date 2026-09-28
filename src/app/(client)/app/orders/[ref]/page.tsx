import { notFound } from "next/navigation";
import { requireClientPage, NotFound } from "@/server/shared/authorize";
import { getClientOrder } from "@/server/client/orders";
import { ClientOrderView } from "@/components/app/orders/order-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

/** F-10 — the client order page. Other orgs' refs are 404 (the repository scopes by ctx.orgId). */
export default async function ClientOrderRoute({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const ctx = await requireClientPage(`/app/orders/${ref}`);
  let dto;
  try { dto = await getClientOrder(ctx, ref); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return <ClientOrderView dto={dto} />;
}
