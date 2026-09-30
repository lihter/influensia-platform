import { notFound } from "next/navigation";
import { Gauge } from "lucide-react";
import { requireOpsPage, isAdmin, NotFound } from "@/server/shared/authorize";
import { getClient } from "@/server/ops/clients";
import { PageHeader } from "@/components/shared/page-header";
import { SectionHeading } from "@/components/shared/section-band";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { EmptyState } from "@/components/shared/empty-state";
import { DateTime } from "@/components/shared/formatters";
import { Badge } from "@/components/ui/badge";
import { ClientSettingsCard } from "@/components/ops/clients/client-settings-card";
import { ClientUsersCard } from "@/components/ops/clients/client-users-card";
import { ClientLinesTable, ClientOrdersTable } from "@/components/ops/clients/client-work-tables";
import { S, COMMERCIAL_MODE_LABEL, PRICING_DISPLAY_LABEL } from "@/components/ops/clients/strings";
import { updateClientSettingsAction, addClientUserAction, deactivateUserAction, reactivateUserAction, resendInviteAction } from "../actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Client ${id.slice(0, 8)}` };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="font-mono text-[13px] tabular-nums text-foreground">{children}</span>
    </div>
  );
}

/** F-26 client page: Settings · Users · Lines · Orders · Forecast accuracy (placeholder) · Activity. Admin edits; agents read. */
export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOpsPage(`/ops/clients/${id}`);
  if (!UUID.test(id)) notFound();
  const detail = await getClient(ctx, id).catch((e) => { if (e instanceof NotFound) return null; throw e; });
  if (!detail) notFound();
  const { org, users, lines, orders, activity } = detail;
  const admin = isAdmin(ctx);
  const entries: TimelineEntry[] = activity.map((e) => ({
    id: e.id, kind: e.type === "user_invited" ? "action_milestone" : "system", at: e.at, title: e.text, author: e.actorName, visibility: "internal",
  }));

  return (
    <>
      <PageHeader
        sticky
        crumbs={[{ href: "/ops/clients", label: "Clients" }, { label: org.name }]}
        eyebrow={`Client · ${org.country ?? "—"}${org.vatId ? ` · ${org.vatId}` : ""}`}
        title={org.name}
        titleSuffix={`since ${new Date(org.createdAt).getFullYear()}`}
        meta={
          <>
            <Badge variant="neutral">{COMMERCIAL_MODE_LABEL[org.commercialMode]}</Badge>
            <Badge variant="neutral">{PRICING_DISPLAY_LABEL[org.pricingDisplay]}</Badge>
            <Badge variant="outline" className="font-mono normal-case tracking-normal">{org.defaultIncoterm}</Badge>
            <span className="font-mono text-xs text-muted-foreground">{org.users} user{org.users === 1 ? "" : "s"} · {org.openLines} active lines · {org.openOrders} orders</span>
          </>
        }
      />
      <div className="grid xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8 py-6 xl:pr-6">
          <section aria-labelledby="s-lines">
            <SectionHeading number={1} title={<span id="s-lines">{S.detail.lines} <span className="font-mono text-sm font-normal text-muted-foreground">{lines.length}</span></span>} className="mb-4" />
            <ClientLinesTable rows={lines} />
          </section>
          <section aria-labelledby="s-orders">
            <SectionHeading number={2} title={<span id="s-orders">{S.detail.orders} <span className="font-mono text-sm font-normal text-muted-foreground">{orders.length}</span></span>} className="mb-4" />
            <ClientOrdersTable rows={orders} />
          </section>
          <section aria-labelledby="s-users">
            <SectionHeading number={3} title={<span id="s-users">{S.detail.users} <span className="font-mono text-sm font-normal text-muted-foreground">{users.length}</span></span>} className="mb-4" />
            <ClientUsersCard orgId={org.id} orgName={org.name} users={users} admin={admin} actions={{ add: addClientUserAction, deactivate: deactivateUserAction, reactivate: reactivateUserAction, resend: resendInviteAction }} />
          </section>
          <section aria-labelledby="s-settings">
            <SectionHeading number={4} title={<span id="s-settings">{S.detail.settings}</span>} className="mb-4" />
            <ClientSettingsCard org={org} admin={admin} save={updateClientSettingsAction} />
          </section>
          <section aria-labelledby="s-activity">
            <SectionHeading number={5} title={<span id="s-activity">{S.detail.activity}</span>} className="mb-4" />
            <div className="rounded-xl border border-border bg-card p-5">
              <Timeline entries={entries} showVisibility={false} limit={10} emptyText={S.detail.activityEmpty} />
            </div>
          </section>
        </div>
        <aside className="band-alt -mb-12 py-6 xl:-mr-6 xl:min-h-[calc(100dvh-10rem)] xl:border-l xl:border-hairline-strong xl:px-5 xl:[border-image-source:none] max-xl:hidden" aria-label="Client facts"><div className="xl:sticky-under-header">
          <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">At a glance</div>
          <div className="mt-2 divide-y divide-hairline-faint">
            <Fact label="Users">{org.users}</Fact>
            <Fact label="Active lines">{org.openLines}</Fact>
            <Fact label="Orders">{org.openOrders}</Fact>
            <Fact label="Deposit">{org.depositPct} %</Fact>
            <Fact label="Currency">{org.currencyDisplay}</Fact>
            <Fact label="Timezone">{org.timezone}</Fact>
            <Fact label="Last activity">{org.lastActivityAt ? <DateTime value={org.lastActivityAt} variant="short" /> : "—"}</Fact>
            <Fact label="Created"><DateTime value={org.createdAt} variant="short" /></Fact>
            {org.partnerName && <Fact label="Partner">{org.partnerName}</Fact>}
          </div>
          <div className="mt-6 rounded-xl border border-border bg-card" data-testid="forecast-placeholder">
            <div className="px-4 pt-4 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{S.detail.forecast}</div>
            <EmptyState icon={Gauge} title="Not enough data" body={S.detail.forecastBody} className="py-6" />
          </div>
        </div></aside>
      </div>
    </>
  );
}
