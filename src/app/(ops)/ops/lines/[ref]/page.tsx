import { notFound } from "next/navigation";
import { requireOpsPage } from "@/server/shared/authorize";
import { getOpsLine } from "@/server/ops/participations";
import { NotFound } from "@/server/shared/authorize";
import { LineHeader } from "@/components/ops/board/line-header";
import { LineRail } from "@/components/ops/board/line-rail";
import { SpecTab } from "@/components/ops/board/spec-tab";
import { CostTab } from "@/components/ops/board/cost-tab";
import { SourcingBoard } from "@/components/ops/board/sourcing-board";
import { OfferBuilder } from "@/components/ops/board/offer-builder";
import { TimelineTab } from "@/components/ops/board/timeline-tab";
import { TABS, type Tab } from "@/components/ops/board/strings";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

/** SPEC F-15…F-20 — one page, five tabs (`?tab=`), sticky header, right rail (hidden on the sourcing board). */
export default async function OpsLinePage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ tab?: string; parts?: string }> }) {
  const { ref } = await params;
  const ctx = await requireOpsPage(`/ops/lines/${ref}`);
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "spec";
  let line;
  try { line = await getOpsLine(ctx, ref); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  const fullWidth = tab === "sourcing" || tab === "offer";
  return (
    <>
      <LineHeader line={line} tab={tab} me={{ id: ctx.userId, role: ctx.role }} />
      <div className={fullWidth ? "" : "grid xl:grid-cols-[minmax(0,1fr)_22rem]"}>
        <div className={fullWidth ? "min-w-0 py-6" : "min-w-0 py-6 xl:pr-6"}>
          {tab === "spec" && <SpecTab line={line} />}
          {tab === "cost" && <CostTab line={line} />}
          {tab === "sourcing" && <SourcingBoard line={line} />}
          {tab === "offer" && <OfferBuilder line={line} preselect={(sp.parts ?? "").split(",").filter(Boolean)} isAdmin={ctx.role === "admin"} />}
          {tab === "timeline" && <TimelineTab line={line} />}
        </div>
        {!fullWidth && <LineRail line={line} />}
      </div>
    </>
  );
}
