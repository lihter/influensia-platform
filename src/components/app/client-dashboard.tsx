import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ClientDashboardDto, ClientWaitingItemDto, ClientOrderRowDto, ClientProductRowDto } from "@/server/client/dto";
import { formatMoney } from "@/server/shared/money";
import { fmtDate, fmtDateShort } from "@/lib/format-date";
import { WaitingOnYouCard, type WaitingItem } from "@/components/shared/waiting-on-you-card";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { PageBand } from "@/components/shared/section-band";
import { Ref } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { OrdersTable, ProductsTable, SeeAll } from "./portal/tables";

function waitingItem(w: ClientWaitingItemDto, t: ReturnType<typeof useTranslations<"waiting">>): WaitingItem {
  const money = (i: number) => (w.amounts[i] ? formatMoney(w.amounts[i]) : "");
  const date = w.dueOn ? fmtDate(w.dueOn) : null;
  const title =
    w.reason === "offer_sent" ? t("offer_sent", { name: w.name })
    : w.reason === "sample_received" ? t("sample_received", { name: w.name })
    : w.reason === "deposit_due" ? t("deposit_due_nodate", { deposit: money(0), fee: money(1) })
    : w.reason === "artwork_due" ? (w.artworkChangesRequested ? t("artwork_changes", { name: w.name }) : t("artwork_due", { name: w.name }))
    : w.reason === "balance_due" ? t("balance_due_nodate", { amount: money(0) })
    : w.reason === "delivery_confirm" ? t("delivery_confirm", { ref: w.entityRef })
    : t("needs_input", { name: w.name });
  return {
    id: w.id,
    title,
    context: w.reason === "needs_input" && w.questionExcerpt ? `“${w.questionExcerpt}”` : w.reason === "delivery_confirm" ? `${w.name} · delivered ${fmtDateShort(w.since)}` : <Ref muted>{w.entityRef}</Ref>,
    due: date ? `${w.reason === "offer_sent" ? "valid until" : "due"} ${fmtDateShort(w.dueOn)}` : undefined,
    action: { label: t(`button.${w.reason}`), href: w.href },
  };
}

/** The client dashboard body (server component; receives the DTO only). Bands: white (waiting) · page (in progress) · alt (updates) · ink (CTA). */
export function ClientDashboardView({ dto, orders, products }: { dto: ClientDashboardDto; orders: ClientOrderRowDto[]; products: ClientProductRowDto[] }) {
  const t = useTranslations("app.dashboard");
  const tw = useTranslations("waiting");
  const entries: TimelineEntry[] = dto.recentUpdates.map((u) => ({
    id: u.id, kind: u.kind === "comment" ? "note" : u.isActionMilestone ? "action_milestone" : "milestone", at: u.at,
    title: u.kind === "comment" ? undefined : u.text, body: u.kind === "comment" ? u.text : undefined,
    author: u.kind === "comment" ? (u.byYou ? "You" : u.authorName ?? undefined) : u.authorName ?? undefined,
  }));
  const waiting = dto.waiting.map((w) => waitingItem(w, tw));

  return (
    <>
      <PageBand tone="white" pad="none" className="pt-5 pb-6" aria-label={tw("eyebrow")}>
        <WaitingOnYouCard items={waiting} />
      </PageBand>

      <PageBand tone="page" pad="lg" aria-labelledby="orders-h">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="orders-h" className="text-lg font-semibold">Orders <span className="font-mono text-sm font-normal text-muted-foreground">{orders.length}</span></h2>
          {orders.length > 0 && <SeeAll href="/app/orders" label={orders.length > 5 ? `All ${orders.length} orders` : "Orders"} />}
        </div>
        <OrdersTable rows={orders} compact limit={5} />
      </PageBand>

      <PageBand tone="alt" pad="lg" aria-labelledby="products-h">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="products-h" className="text-lg font-semibold">Products <span className="font-mono text-sm font-normal text-muted-foreground">{products.length}</span></h2>
          {products.length > 0 && <SeeAll href="/app/products" label={`All ${products.length} products`} />}
        </div>
        <ProductsTable rows={products} compact limit={6} />
      </PageBand>

      <PageBand tone="page" pad="lg" aria-labelledby="recent-h">
        <h2 id="recent-h" className="mb-3 text-lg font-semibold">{t("recent")}</h2>
        <div className="rounded-xl border border-border bg-card p-5 [overflow-wrap:anywhere]">
          <Timeline entries={entries} emptyText={t("recentEmpty")} />
        </div>
      </PageBand>

      <PageBand tone="ink" pad="lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">{t("ctaTitle")}</h2>
            <p className="text-sm text-white/65">{t("ctaBody")}</p>
          </div>
          <Button asChild variant="action" size="lg"><Link href="/app/requests/new">{t("ctaButton")}</Link></Button>
        </div>
      </PageBand>
    </>
  );
}
