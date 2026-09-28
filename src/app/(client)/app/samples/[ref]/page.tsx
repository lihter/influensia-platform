import { notFound } from "next/navigation";
import { requireClientPage, NotFound } from "@/server/shared/authorize";
import { getClientSample } from "@/server/client/samples";
import { ClientSamplePage } from "@/components/app/lines/sample-page";
import { approveSampleAction, rejectSampleAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

/** SPEC F-09 — approve / reject with photos. Only ClientSampleDto reaches the page. */
export default async function SamplePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const ctx = await requireClientPage(`/app/samples/${ref}`);
  let dto;
  try { dto = await getClientSample(ctx, ref); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return <ClientSamplePage sample={dto} approve={approveSampleAction} reject={rejectSampleAction} />;
}
