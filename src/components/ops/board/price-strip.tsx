"use client";
/**
 * Sourcing-board price strip (UX signature #3): one horizontal USD/unit number line above the board table.
 * Every quote is a dot at its normalised USD/unit price, coloured by participation status (legend below, value label on
 * each dot, staggered above/below so labels never collide). Dashed ink rule = cost floor, solid green rule = target.
 * Hovering a dot highlights its table row and vice-versa (shared `hoveredId`); clicking a dot scrolls to the row.
 * One axis, no gridlines, text in ink tokens — the colour sits on the marks only.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import type { ParticipationStatus } from "@/db/enums";
import { formatUnitPrice } from "@/server/shared/money";
import { cn } from "@/lib/utils";

export type StripPoint = { id: string; label: string; usdMinorE2: number; status: ParticipationStatus; flagged: boolean };

/** Status → mark colour. Excluded statuses are hollow + faint; selected is filled deep green with a ring. */
const STATUS_MARK: Record<ParticipationStatus, { fill: string; stroke: string; hollow?: boolean }> = {
  contacted: { fill: "var(--neutral)", stroke: "var(--neutral)" },
  quoted: { fill: "var(--info)", stroke: "var(--info)" },
  shortlisted: { fill: "var(--green-500)", stroke: "var(--green-500)" },
  negotiating: { fill: "var(--warning)", stroke: "var(--warning)" },
  selected: { fill: "var(--green-700)", stroke: "var(--green-700)" },
  backup: { fill: "var(--card)", stroke: "var(--green-600)", hollow: true },
  dropped: { fill: "var(--card)", stroke: "var(--faint-fg)", hollow: true },
  cannot_make: { fill: "var(--card)", stroke: "var(--faint-fg)", hollow: true },
};

const usd = (e2: number) => formatUnitPrice({ minorE2: e2, currency: "USD" }, { decimals: 4 });
const H = 116, AXIS = 62, PAD_X = 28, LABEL_W = 58;

export function PriceStrip({ points, floorE2, targetE2, unit, hoveredId, onHover, onPick }: {
  points: StripPoint[]; floorE2: number | null; targetE2: number | null; unit: string;
  hoveredId: string | null; onHover: (id: string | null) => void; onPick: (id: string) => void;
}) {
  const ts = useTranslations("participation_status");
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(900);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!points.length) return null;
  const values = [...points.map((p) => p.usdMinorE2), ...(floorE2 ? [floorE2] : []), ...(targetE2 ? [targetE2] : [])];
  const lo = Math.min(...values) * 0.92, hi = Math.max(...values) * 1.05;
  const x = (v: number) => PAD_X + ((v - lo) / (hi - lo || 1)) * (w - PAD_X * 2);

  // value labels: sorted by x, alternate lanes above/below the axis, drop to the far lane on collision
  const sorted = [...points].sort((a, b) => a.usdMinorE2 - b.usdMinorE2);
  const lastEnd = { above: -Infinity, below: -Infinity };
  const placed = new Map<string, "above" | "below" | null>();
  for (const p of sorted) {
    const cx = x(p.usdMinorE2), start = cx - LABEL_W / 2;
    const lane = start > lastEnd.above ? "above" : start > lastEnd.below ? "below" : null;
    placed.set(p.id, lane);
    if (lane) lastEnd[lane] = cx + LABEL_W / 2;
  }
  const refs = [
    floorE2 ? { key: "floor", v: floorE2, label: "Cost floor", dash: "4 3", color: "var(--foreground)" } : null,
    targetE2 ? { key: "target", v: targetE2, label: "Target", dash: undefined, color: "var(--green-600)" } : null,
  ].filter(Boolean) as { key: string; v: number; label: string; dash?: string; color: string }[];
  const present = [...new Set(points.map((p) => p.status))];
  const hovered = points.find((p) => p.id === hoveredId) ?? null;

  return (
    <figure className="border-b border-hairline-strong bg-card px-4 pt-3 pb-2" data-testid="price-strip" aria-label={`Quotes in USD per ${unit}`}>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="eyebrow">Quotes · USD / {unit}</span>
        {present.map((s) => {
          const m = STATUS_MARK[s];
          return (
            <span key={s} className="inline-flex items-center gap-1.5">
              <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" fill={m.fill} stroke={m.stroke} strokeWidth={m.hollow ? 1.5 : 0} /></svg>
              {ts(s)}
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1.5"><svg width="14" height="10" aria-hidden><line x1="7" y1="0" x2="7" y2="10" stroke="var(--foreground)" strokeWidth="1.5" strokeDasharray="3 2" /></svg>Cost floor</span>
        <span className="inline-flex items-center gap-1.5"><svg width="14" height="10" aria-hidden><line x1="7" y1="0" x2="7" y2="10" stroke="var(--green-600)" strokeWidth="2" /></svg>Target</span>
        {hovered && <span className="ml-auto font-medium text-foreground">{hovered.label} · <span className="font-mono">{usd(hovered.usdMinorE2)}</span> · {ts(hovered.status)}{hovered.flagged ? " · flagged" : ""}</span>}
      </figcaption>
      <div ref={ref} className="relative">
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block overflow-visible" role="img" aria-label={sorted.map((p) => `${p.label} ${usd(p.usdMinorE2)}`).join(", ")}>
          <line x1={PAD_X} x2={w - PAD_X} y1={AXIS} y2={AXIS} stroke="var(--hairline-strong)" strokeWidth="1" />
          {refs.map((r) => (
            <g key={r.key}>
              <line x1={x(r.v)} x2={x(r.v)} y1={12} y2={H - 14} stroke={r.color} strokeWidth={r.dash ? 1.5 : 2} strokeDasharray={r.dash} />
              <text x={x(r.v)} y={r.key === "floor" ? 8 : H - 2} textAnchor="middle" stroke="var(--card)" strokeWidth={3} paintOrder="stroke" className="fill-foreground font-sans text-[10px] font-semibold">{r.label} <tspan className="font-mono font-medium">{usd(r.v)}</tspan></text>
            </g>
          ))}
          {sorted.map((p) => {
            const m = STATUS_MARK[p.status];
            const cx = x(p.usdMinorE2);
            const on = hoveredId === p.id;
            const lane = placed.get(p.id);
            return (
              <g key={p.id} className="cursor-pointer" onMouseEnter={() => onHover(p.id)} onMouseLeave={() => onHover(null)} onClick={() => onPick(p.id)} data-testid="strip-dot" data-pid={p.id}>
                <circle cx={cx} cy={AXIS} r={14} fill="transparent" />
                {on && <circle cx={cx} cy={AXIS} r={9} fill="none" stroke="var(--foreground)" strokeWidth="1.5" />}
                <circle cx={cx} cy={AXIS} r={p.status === "selected" ? 6 : 5} fill={m.fill} stroke={p.status === "selected" ? "var(--card)" : m.stroke} strokeWidth={m.hollow ? 1.75 : 2} />
                {p.status === "selected" && <circle cx={cx} cy={AXIS} r={8.5} fill="none" stroke="var(--green-700)" strokeWidth="1.25" />}
                {(p.status === "dropped" || p.status === "cannot_make") && <path d={`M${cx - 2.5} ${AXIS - 2.5} L${cx + 2.5} ${AXIS + 2.5} M${cx + 2.5} ${AXIS - 2.5} L${cx - 2.5} ${AXIS + 2.5}`} stroke="var(--faint-fg)" strokeWidth="1.25" />}
                {lane && (
                  <text x={cx} y={lane === "above" ? AXIS - 14 : AXIS + 22} textAnchor="middle" stroke="var(--card)" strokeWidth={3} paintOrder="stroke" className={cn("font-mono text-[10.5px] tabular-nums", on ? "fill-foreground font-semibold" : p.status === "dropped" || p.status === "cannot_make" ? "fill-faint" : "fill-ink-2")}>
                    {usd(p.usdMinorE2)}
                  </text>
                )}
                <title>{`${p.label} · ${usd(p.usdMinorE2)} / ${unit} · ${ts(p.status)}${p.flagged ? " · flagged" : ""}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
