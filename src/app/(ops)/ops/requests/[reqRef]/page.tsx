import { notFound } from "next/navigation";
import { requireOpsPage, NotFound } from "@/server/shared/authorize";
import { getOpsRequest } from "@/server/ops/requests";
import { OpsRequestDetailView } from "@/components/ops/requests/request-detail";
import { claimQueueLineAction, assignQueueLinesAction } from "../../queue/actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ reqRef: string }> }) {
  return { title: (await params).reqRef };
}

/** F-14 / F-15 header — request (ops): client, lines with state / waiting / stale / agent, notes, documents, activity. */
export default async function OpsRequestPage({ params }: { params: Promise<{ reqRef: string }> }) {
  const { reqRef } = await params;
  const ctx = await requireOpsPage(`/ops/requests/${reqRef}`);
  let dto;
  try {
    dto = await getOpsRequest(ctx, reqRef);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  return <OpsRequestDetailView dto={dto} me={{ id: ctx.userId, name: ctx.name }} claim={claimQueueLineAction} assign={assignQueueLinesAction} />;
}
