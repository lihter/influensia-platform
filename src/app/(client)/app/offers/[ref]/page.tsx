import { notFound } from "next/navigation";
import { requireClientPage, NotFound } from "@/server/shared/authorize";
import { getClientOffer } from "@/server/client/offers";
import { ClientOfferPage } from "@/components/app/lines/offer-page";
import { acceptOfferAction, requestChangesAction, declineOfferAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

/** SPEC F-08 — options A/B/C, accept / ask for changes / decline. Only ClientOfferDto reaches the page. */
export default async function OfferPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const ctx = await requireClientPage(`/app/offers/${ref}`);
  let data;
  try { data = await getClientOffer(ctx, ref); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return <ClientOfferPage offer={data.offer} versions={data.versions} actions={{ accept: acceptOfferAction, changes: requestChangesAction, decline: declineOfferAction }} />;
}
