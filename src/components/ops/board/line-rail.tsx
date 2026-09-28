import Link from "next/link";
import type { OpsLine } from "@/server/ops/participations";
import { formatQty, formatUnitPrice, formatMoney } from "@/server/shared/money";
import { fmtDate as formatDate } from "@/lib/format-date";
import { label } from "@/lib/labels";
import { VisibilityBadge } from "@/components/shared/chips";
import { UnitPrice } from "@/components/shared/formatters";

/** DESIGN §6.8 right rail — section-alt band: facts, previous orders (client-visible + other clients, Internal). */
export function LineRail({ line }: { line: OpsLine }) {
  const facts: { label: string; value: React.ReactNode; sub?: string }[] = [
    { label: "Qty first", value: line.qty ? formatQty(line.qty, line.unit) : "—" },
    { label: "12-month volume", value: line.volume12m ? formatQty(line.volume12m, line.unit) : "—" },
    { label: "Target", value: line.targetPriceMinorE2 ? <UnitPrice minorE2={line.targetPriceMinorE2} unit={line.unit} decimals={4} /> : <span className="text-warning">no target</span> },
    { label: "Cost floor", value: line.costModel ? formatUnitPrice({ minorE2: line.costModel.est_prod_cost_minor_e2, currency: "USD" }, { decimals: 4 }) : "—" },
    { label: "Deadline", value: line.request.targetDelivery ? formatDate(line.request.targetDelivery) : "—" },
    { label: "Destination / incoterm", value: `${line.request.destination ?? "—"} · ${line.request.incotermWanted ?? line.org.defaultIncoterm}` },
  ];
  const mine = line.previousOrders.filter((o) => o.orgName === line.org.name);
  const others = line.previousOrders.filter((o) => o.orgName !== line.org.name);
  return (
    <aside className="band-alt -mb-12 py-6 xl:-mr-6 xl:min-h-[calc(100dvh-10rem)] xl:border-l xl:border-hairline-strong xl:px-5 xl:[border-image:none]" data-testid="line-rail">
      <div className="xl:sticky-under-header">
      <dl className="rounded-xl border border-border bg-card">
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-hairline-faint px-4 py-2.5 last:border-b-0">
            <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{f.label}</dt>
            <dd className="text-right font-mono text-sm font-medium whitespace-nowrap text-foreground">{f.value}</dd>
          </div>
        ))}
      </dl>
      {line.product && (
        <div className="mt-4 text-xs text-ink-2">
          Product <Link href={`/ops/products/${line.product.ref}`} className="link font-mono">{line.product.ref}</Link> · {label("productVisibility", line.product.visibility)}
          {line.product.referencePriceMinorE2 && <span className="ml-1 font-mono">· ref {formatUnitPrice({ minorE2: line.product.referencePriceMinorE2, currency: "USD" })}</span>}
        </div>
      )}
      <section className="mt-6">
        <div className="eyebrow mb-2">This client ordered this product</div>
        {mine.length === 0 ? <p className="text-xs text-muted-foreground">No previous orders.</p> : (
          <ul className="sheet">
            {mine.map((o) => (
              <li key={o.orderRef} className="sheet-row flex items-center justify-between text-xs">
                <Link href={`/ops/orders/${o.orderRef}`} className="link font-mono">{o.orderRef}</Link>
                <span className="font-mono">{formatQty(o.qty, o.unit)} · {formatUnitPrice({ minorE2: o.unitPriceMinorE2, currency: o.currency })}{o.feeMinor ? ` + ${formatMoney({ minor: o.feeMinor, currency: o.currency })}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-6">
        <div className="eyebrow mb-2 flex items-center gap-2">Other clients&apos; orders of this product <VisibilityBadge visibility="internal" /></div>
        {others.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
          <ul className="sheet">
            {others.map((o) => (
              <li key={o.orderRef} className="sheet-row text-xs" data-testid="previous-order">
                <div className="flex items-center justify-between"><Link href={`/ops/orders/${o.orderRef}`} className="link font-mono">{o.orderRef}</Link><span className="font-mono">{formatUnitPrice({ minorE2: o.unitPriceMinorE2, currency: o.currency })}</span></div>
                <div className="text-muted-foreground">{o.orgName} · {o.supplierName ?? "—"} · {formatDate(o.confirmedAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="mt-6">
        <Link href={`/ops/lines/${line.ref}?tab=timeline#whatsapp`} className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-input bg-card text-sm font-medium hover:bg-surface-sunken">Log WhatsApp</Link>
      </div>
      </div>
    </aside>
  );
}
