import { notFound } from "next/navigation";
import { requireClientPage, NotFound } from "@/server/shared/authorize";
import { getClientLine } from "@/server/client/lines";
import { ClientLinePage } from "@/components/app/lines/line-page";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

/** SPEC F-07 — one line, everything on one page. Data only via ClientLinePageDto (strict, denylisted). */
export default async function LinePage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { ref } = await params;
  const ctx = await requireClientPage(`/app/lines/${ref}`);
  const { tab } = await searchParams;
  let dto;
  try { dto = await getClientLine(ctx, ref); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return <ClientLinePage dto={dto} initialTab={tab} />;
}
