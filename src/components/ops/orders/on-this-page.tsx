"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * "On this page" rail with scroll-spy (UX signature #6): highlights the section in view (font-semibold + 2px green bar),
 * open counts as amber "N open" micro-chips, smooth scroll on click (instant under reduced motion).
 */
export function OnThisPage({ items }: { items: { id: string; label: string; number: number; open: number }[] }) {
  const [active, setActive] = React.useState(items[0]?.id);
  React.useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((x): x is HTMLElement => !!x);
    if (!els.length) return;
    const pick = () => {
      const top = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ops-header-h")) || 128) + 32;
      let current = els[0].id;
      for (const el of els) if (el.getBoundingClientRect().top - top <= 0) current = el.id;
      // at the very bottom, the last section is the one being read
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = els[els.length - 1].id;
      setActive(current);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => { window.removeEventListener("scroll", pick); window.removeEventListener("resize", pick); };
  }, [items]);
  const go = (e: React.MouseEvent, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
    setActive(id);
  };
  return (
    <nav className="sticky-under-header px-4 py-6" aria-label="On this page" data-testid="page-nav">
      <div className="eyebrow mb-3 px-2">On this page</div>
      <ol className="flex flex-col gap-0.5 border-l border-hairline-strong">
        {items.map((it) => {
          const on = it.id === active;
          return (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                onClick={(e) => go(e, it.id)}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "relative -ml-px flex h-8 items-center gap-2 border-l-2 pr-2 pl-3 text-sm transition-colors duration-[120ms]",
                  on ? "border-green-600 font-semibold text-foreground" : "border-transparent text-ink-2 hover:border-hairline-strong hover:text-foreground",
                )}
              >
                <span className={cn("font-mono text-2xs", on ? "text-green-700" : "text-muted-foreground")}>{String(it.number).padStart(2, "0")}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.open > 0 && <span className="inline-flex h-5 items-center rounded-md border border-warning-border bg-warning-wash px-1.5 font-mono text-2xs font-medium text-warning">{it.open} open</span>}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
