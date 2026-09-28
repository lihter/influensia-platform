import { cn } from "@/lib/utils";

export type Fact = { label: string; value: React.ReactNode; sub?: React.ReactNode };

/** DESIGN §5.18 — one white card, 2/4 cells divided by hairlines; eyebrow label, mono-large value, muted sub. */
export function FactsStrip({ facts, className, columns = 4 }: { facts: Fact[]; className?: string; columns?: 2 | 3 | 4 }) {
  return (
    <dl className={cn("grid grid-cols-2 divide-y divide-hairline-faint overflow-hidden rounded-xl border border-border bg-card md:divide-y-0 md:divide-x", columns === 4 ? "md:grid-cols-4" : columns === 3 ? "md:grid-cols-3" : "md:grid-cols-2", className)} data-testid="facts-strip">
      {facts.map((f) => (
        <div key={f.label} className="px-5 py-4">
          <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{f.label}</dt>
          <dd className="mt-1 font-mono text-[1.25rem] font-medium leading-7 tracking-[-0.01em] text-foreground">{f.value}</dd>
          {f.sub && <dd className="mt-0.5 text-xs text-muted-foreground">{f.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
