import Link from "next/link";
import { ImageOff } from "lucide-react";
import type { ClientCatalogDto } from "@/server/client/dto";
import { formatDate } from "@/server/shared/dates";
import { formatQty } from "@/server/shared/money";
import { UnitPrice } from "@/components/shared/formatters";
import { UtilityBadge } from "@/components/shared/chips";
import { cn } from "@/lib/utils";

/** Small print under the price: "at 1,000 set · FOB Qingdao · spec v2 · valid until 31 Dec 2026". */
export function referenceMeta(p: ClientCatalogDto): string {
  return [
    p.referenceMoq != null ? `at ${formatQty(p.referenceMoq, p.unit)}` : null,
    p.referenceIncoterm ? `${p.referenceIncoterm} ${p.referencePort ?? ""}`.trim() : null,
    p.referenceSpecVersion != null ? `spec v${p.referenceSpecVersion}` : null,
    p.referenceValidUntil ? `valid until ${formatDate(p.referenceValidUntil)}` : null,
  ].filter(Boolean).join(" · ");
}

export function CatalogImage({ image, name, className }: { image: { url: string } | null; name: string; className?: string }) {
  return (
    <div className={cn("relative aspect-[4/3] w-full overflow-hidden bg-section-alt", className)}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by /api/files (same origin, access-checked), not an optimisable remote host
        <img src={image.url} alt={name} className="size-full object-cover" loading="lazy" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground"><ImageOff className="size-5" strokeWidth={1.75} /><span className="text-xs">Image coming</span></div>
      )}
    </div>
  );
}

export function ReferencePrice({ p, size = "md" }: { p: ClientCatalogDto; size?: "md" | "lg" }) {
  return (
    <div>
      {p.referencePrice && !p.priceStale ? (
        <UnitPrice minorE2={p.referencePrice.minorE2} currency={p.referencePrice.currency} unit={p.unit} size={size === "lg" ? "lg" : "sm"} className={size === "md" ? "text-base" : undefined} />
      ) : (
        <span className={cn("font-medium text-ink-2", size === "lg" ? "text-lg" : "text-base")} data-testid="price-tbc">price to be confirmed</span>
      )}
      <p className="mt-0.5 text-xs text-muted-foreground">{referenceMeta(p)}</p>
    </div>
  );
}

/**
 * DESIGN §6.5 product card: clean image 4:3, name 15/500, reference price mono 16/500 + small print, "Request offer"
 * outline button full width. Receives only the client DTO. The ops product page renders the same card as its preview.
 */
export function CatalogCard({ p, action, href }: { p: ClientCatalogDto; action?: React.ReactNode; href?: string }) {
  const top = (
    <>
      <CatalogImage image={p.image} name={p.name} className="rounded-t-xl" />
      <div className="p-4 pb-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-medium leading-5 text-foreground">{p.name}</h3>
          {p.orderedBefore && <UtilityBadge kind="repeat" className="shrink-0">Ordered before</UtilityBadge>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{p.category ?? "—"} · <span className="font-mono">{p.ref}</span></p>
      </div>
    </>
  );
  return (
    <article className={cn("flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card", href && "transition-shadow duration-[120ms] hover:shadow-sm")} data-testid="catalog-card" data-ref={p.ref}>
      {href ? <Link href={href} className="block rounded-t-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={p.name}>{top}</Link> : top}
      <div className="flex flex-1 flex-col p-4 pt-3">
        <ReferencePrice p={p} />
        {action && <div className="mt-4 flex-1 self-end w-full">{action}</div>}
      </div>
    </article>
  );
}
