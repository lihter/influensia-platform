"use client";
import * as React from "react";

/**
 * Publishes the sticky page header's height as `--ops-header-h` on <html> so rails (`top-[calc(var(--ops-header-h)+…)]`)
 * and anchors (`scroll-mt-…`) sit exactly under it, whatever the header wraps to.
 */
export function StickyHeaderVar() {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const header = ref.current?.closest("header");
    if (!header) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--ops-header-h", `${Math.round(header.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(header);
    return () => { ro.disconnect(); root.style.removeProperty("--ops-header-h"); };
  }, []);
  return <span ref={ref} hidden />;
}
