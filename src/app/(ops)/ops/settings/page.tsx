import { requireOpsPage, isAdmin } from "@/server/shared/authorize";
import { getAgencySettings } from "@/server/ops/settings";
import { PageHeader } from "@/components/shared/page-header";
import { SectionHeading } from "@/components/shared/section-band";
import { AgencyProfileCard, PricingRulesTable, FxRatesTable } from "@/components/ops/settings/settings-view";
import { updateAgencyProfileAction, savePricingRuleAction, deletePricingRuleAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

/** /ops/settings — agency profile, pricing rules (admin edits), FX rates viewer. Agents read-only (SPEC §1.4). */
export default async function OpsSettingsPage() {
  const ctx = await requireOpsPage("/ops/settings");
  const s = await getAgencySettings(ctx);
  const admin = isAdmin(ctx);
  return (
    <>
      <PageHeader eyebrow="Agency" title="Settings" titleSuffix={admin ? "admin" : "read-only"} />
      <div className="flex max-w-[64rem] flex-col gap-8">
        <section aria-labelledby="s-profile">
          <SectionHeading number={1} title={<span id="s-profile">Agency profile</span>} className="mb-4" />
          <AgencyProfileCard s={s} admin={admin} save={updateAgencyProfileAction} />
        </section>
        <section aria-labelledby="s-rules">
          <SectionHeading number={2} title={<span id="s-rules">Pricing rules <span className="font-mono text-sm font-normal text-muted-foreground">{s.pricingRules.length}</span></span>} className="mb-4" />
          <PricingRulesTable rules={s.pricingRules} admin={admin} actions={{ saveRule: savePricingRuleAction, deleteRule: deletePricingRuleAction }} />
        </section>
        <section aria-labelledby="s-fx">
          <SectionHeading number={3} title={<span id="s-fx">FX rates <span className="font-mono text-sm font-normal text-muted-foreground">{s.fxRates.length}</span></span>} className="mb-4" />
          <FxRatesTable rates={s.fxRates} />
          <p className="mt-2 text-xs text-muted-foreground">Rates are read by the cost model and the compare bar (latest rate on or before the quote date). Loading new rates is a seed/import task in v1.</p>
        </section>
      </div>
    </>
  );
}
