import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireClientPage, NotFound } from "@/server/shared/authorize";
import { getCatalogProduct } from "@/server/client/catalog";
import { PageHeader } from "@/components/shared/page-header";
import { UtilityBadge } from "@/components/shared/chips";
import { Money, Qty, UnitPrice, DateTime } from "@/components/shared/formatters";
import { CatalogImage, ReferencePrice } from "@/components/app/catalog/catalog-card";
import { RequestOfferForm } from "@/components/app/catalog/request-offer-form";
import { requestOfferAction } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

/** F-11 — product detail: clean images, description, reference spec, "Your previous orders of this product" (own org only), Request offer. */
export default async function CatalogProductPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const ctx = await requireClientPage(`/app/catalog/${ref}`);
  let p;
  try { p = await getCatalogProduct(ctx, ref); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/app/catalog" className="link inline-flex items-center gap-1 normal-case tracking-normal"><ArrowLeft className="size-3" />Catalog</Link>}
        title={p.name}
        meta={<><span>{p.category ?? "—"}</span><span className="font-mono text-xs">{p.ref}</span>{p.orderedBefore && <UtilityBadge kind="repeat">Ordered before</UtilityBadge>}</>}
        actions={<RequestOfferForm p={p} action={requestOfferAction} size="lg" />}
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-8">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <CatalogImage image={p.images[0] ?? p.image} name={p.name} className="aspect-[16/9]" />
            {p.images.length > 1 && (
              <ul className="flex gap-2 border-t border-hairline-faint p-3">
                {p.images.map((img) => (
                  <li key={img.id} className="size-16 overflow-hidden rounded-md border border-border bg-section-alt">
                    {/* eslint-disable-next-line @next/next/no-img-element -- /api/files, access-checked */}
                    <img src={img.url} alt="" className="size-full object-cover" />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {p.description && <section><h2 className="mb-2 text-lg font-semibold">About this product</h2><p className="whitespace-pre-wrap text-base text-ink-2">{p.description}</p></section>}
          <section aria-labelledby="spec-h">
            <div className="mb-3 flex items-baseline justify-between border-t border-rule-ink pt-4"><h2 id="spec-h" className="text-lg font-semibold">Specification</h2>{p.referenceSpecVersion != null && <UtilityBadge kind="version">v{p.referenceSpecVersion}</UtilityBadge>}</div>
            {p.spec.length === 0 ? <p className="text-sm text-muted-foreground">We confirm the full specification with your offer.</p> : (
              <dl className="sheet" data-testid="spec-fields">
                {p.spec.map((f) => <div key={f.key} className="sheet-row grid grid-cols-[10rem_1fr] gap-3 text-sm"><dt className="text-muted-foreground capitalize">{f.key}</dt><dd className="font-medium">{f.value}</dd></div>)}
              </dl>
            )}
          </section>
          {p.previousOrders.length > 0 && (
            <section aria-labelledby="prev-h" data-testid="previous-orders">
              <div className="mb-3 border-t border-rule-ink pt-4"><h2 id="prev-h" className="text-lg font-semibold">Your previous orders of this product</h2></div>
              <ul className="sheet">
                {p.previousOrders.map((o) => (
                  <li key={o.orderRef} className="sheet-row flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <Link href={`/app/orders/${o.orderRef}`} className="link font-mono text-xs">{o.orderRef}</Link>
                    <Qty qty={o.qty} unit={o.unit} />
                    <span><UnitPrice minorE2={o.unitPrice.minorE2} currency={o.unitPrice.currency} unit={o.unit} />{o.fee && <span className="text-xs text-ink-2"> + <Money minor={o.fee.minor} currency={o.fee.currency} /> fee</span>}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{o.deliveredAt ? <>delivered <DateTime value={o.deliveredAt} /></> : "in progress"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-5" data-testid="reference-block">
            <p className="eyebrow mb-2">Reference price</p>
            <ReferencePrice p={p} size="lg" />
            <p className="mt-3 text-xs text-muted-foreground">All-in per {p.unit}, including our fee, at the quantity shown. Your offer confirms the price for your quantity and delivery.</p>
            <div className="mt-4"><RequestOfferForm p={p} action={requestOfferAction} className="w-full" size="lg" /></div>
          </div>
        </aside>
      </div>
    </>
  );
}
