"use client";
import { cn } from "@/lib/utils";

/**
 * On/off filter pill with a visible switch (UX: "Mine" / "Stale only" must show their state).
 *   <FilterToggle on={mine} onChange={setMine} data-testid="filter-mine">Mine</FilterToggle>
 * Renders a real checkbox (sr-only) so tests can `check()` it and screen readers announce the state.
 */
export function FilterToggle({ on, onChange, children, className, ...rest }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode; className?: string; "data-testid"?: string }) {
  return (
    <label className={cn("inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-[120ms] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", on ? "border-green-600 bg-green-50 text-green-700" : "border-input bg-card text-ink-2 hover:text-foreground", className)}>
      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => onChange(e.target.checked)} data-testid={rest["data-testid"]} />
      <span aria-hidden className={cn("relative inline-flex h-3.5 w-6 shrink-0 rounded-full transition-colors duration-[120ms]", on ? "bg-green-600" : "bg-input")}>
        <span className={cn("absolute top-0.5 size-2.5 rounded-full bg-white transition-transform duration-[120ms]", on ? "translate-x-3" : "translate-x-0.5")} />
      </span>
      {children}
    </label>
  );
}
