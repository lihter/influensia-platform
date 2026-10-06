"use client";
import { ImageOff } from "lucide-react";
import { HoverCard } from "radix-ui";
import { cn } from "@/lib/utils";

const SIZES = { sm: "size-10", md: "size-14", lg: "size-[4.5rem]", xl: "size-24" } as const;

/**
 * Product picture for tables and lists — the picture leads, the title follows. Hovering a picture (pointer devices)
 * shows a 16rem preview so a row can be recognised without opening it. No photo → a quiet placeholder with the link's
 * domain ("allegro.pl"), which is still more recognisable than a blank.
 */
export function ProductThumb({ image, name, domain, size = "md", preview = true, className }: { image: { url: string } | null; name: string; domain?: string | null; size?: keyof typeof SIZES; preview?: boolean; className?: string }) {
  if (!image) {
    return (
      <div className={cn(SIZES[size], "flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-hairline-strong bg-section-alt text-muted-foreground", className)} data-testid="product-thumb-empty" title={domain ? `No photo yet — ${domain}` : "No photo yet"}>
        <ImageOff className="size-4" strokeWidth={1.75} aria-hidden />
        {domain && size !== "sm" && <span className="max-w-full truncate px-1 text-[10px] leading-3">{domain}</span>}
      </div>
    );
  }
  const thumb = (
    <div className={cn(SIZES[size], "shrink-0 overflow-hidden rounded-lg border border-border bg-section-alt", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- same-origin /api/files (access-checked), not an optimisable remote host */}
      <img src={image.url} alt={name} className="size-full object-cover" loading="lazy" data-testid="product-thumb" />
    </div>
  );
  if (!preview) return thumb;
  return (
    <HoverCard.Root openDelay={120} closeDelay={60}>
      <HoverCard.Trigger asChild>{thumb}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content side="right" align="center" sideOffset={10} className="z-50 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img src={image.url} alt="" className="aspect-square w-full object-cover" />
          <div className="px-3 py-2 text-xs font-medium leading-4 text-foreground">{name}</div>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

/** Up to four overlapping pictures for an order with several products. */
export function ThumbStack({ items, size = "md" }: { items: { name: string; image: { url: string } | null }[]; size?: keyof typeof SIZES }) {
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((it, i) => (
        <ProductThumb key={i} image={it.image} name={it.name} size={size} preview={items.length === 1} className={cn(i > 0 && "-ml-4 ring-2 ring-card")} />
      ))}
      {more > 0 && <span className="-ml-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-card px-1.5 font-mono text-2xs text-ink-2">+{more}</span>}
    </div>
  );
}
