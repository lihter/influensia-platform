import { notFound } from "next/navigation";
import { requireClientPage, NotFound } from "@/server/shared/authorize";
import { getClientRequest } from "@/server/client/requests";
import { RequestPage } from "@/components/app/requests/request-page";
import { submitDraftAction, deleteDraftAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ reqRef: string }> }) {
  return { title: (await params).reqRef };
}

/** F-06 — one request with its lines, request-level updates / documents / history. `?sent=1` shows the confirmation card. */
export default async function ClientRequestPage({ params, searchParams }: { params: Promise<{ reqRef: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { reqRef } = await params;
  const ctx = await requireClientPage(`/app/requests/${reqRef}`);
  const { sent } = await searchParams;
  let dto;
  try {
    dto = await getClientRequest(ctx, reqRef);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  return <RequestPage dto={dto} justSent={sent === "1"} submitDraft={submitDraftAction} deleteDraft={deleteDraftAction} />;
}
