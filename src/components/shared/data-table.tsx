"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useLegacyTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, type LegacyColumnDef, type LegacyRow } from "@tanstack/react-table/legacy";
import { flexRender } from "@tanstack/react-table/flex-render";
import type { SortingState, RowData } from "@tanstack/react-table";
import { cn } from "@/lib/utils";

export type DataTableColumn<T extends RowData> = LegacyColumnDef<T> & {
  meta?: {
    /** right-aligned mono figure column */
    numeric?: boolean;
    /** the deciding number: font-medium text-foreground */
    strong?: boolean;
    /** sticky first column */
    sticky?: boolean;
    className?: string;
    width?: string;
  };
};

export type DataTableProps<T extends RowData> = {
  columns: DataTableColumn<T>[];
  data: T[];
  /** row link (whole row clickable) */
  rowHref?: (row: T) => string | undefined;
  /** stale rows: `15 d` amber in the Last column + 3px warning left bar (DESIGN §5.4) */
  isStale?: (row: T) => boolean;
  isSelected?: (row: T) => boolean;
  isNew?: (row: T) => boolean;
  rowClassName?: (row: T) => string | undefined;
  /** row hover callback (e.g. to sync a chart); called with null on leave */
  onRowHover?: (row: T | null) => void;
  /** extra attributes per row (e.g. data-pid for scroll-into-view) */
  rowProps?: (row: T) => Record<string, string | undefined>;
  density?: "default" | "compact";
  emptyState?: React.ReactNode;
  /** default sort */
  initialSorting?: SortingState;
  /** global filter string (wire to a search input in the toolbar) */
  globalFilter?: string;
  /** cap the container height so the header sticks inside it (ops) */
  maxHeight?: string;
  /** keep the first column visible while scrolling sideways (default true) */
  stickyFirstColumn?: boolean;
  className?: string;
  "data-testid"?: string;
};

/**
 * DESIGN §5.4 — dense TanStack table: sticky uppercase header with the 1px ink rule, 40/36px rows (two-line rows grow to
 * 48px), mono numeric columns, hover/selected/stale/new row treatments, whole-row links, keyboard J/K/Enter.
 * Wide tables scroll sideways with a scroll-edge shadow and a sticky first column (UX #8) — never a silent cut-off.
 * Typography: names/text in Figtree; only refs and figures in mono (`meta.numeric`, <PrimaryCell sub>); buttons never mono.
 */
export function DataTable<T extends RowData>({ columns, data, rowHref, isStale, isSelected, isNew, rowClassName, onRowHover, rowProps, density = "default", emptyState, initialSorting, globalFilter, maxHeight, stickyFirstColumn = true, className, ...rest }: DataTableProps<T>) {
  const router = useRouter();
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting ?? []);
  const [focus, setFocus] = React.useState<number>(-1);
  const table = useLegacyTable<T>({
    columns,
    data,
    state: { sorting, globalFilter: globalFilter ?? "" },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "includesString",
  });
  const rows = table.getRowModel().rows;
  const compact = density === "compact";

  const scroller = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((p) => (p.left === left && p.right === right ? p : { left, right }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, []);
  // exactly one sticky column: the one marked `meta.sticky`, else the first (two left-0 columns would overlap)
  const stickyIndex = (() => { const i = columns.findIndex((c) => c.meta?.sticky); return i >= 0 ? i : stickyFirstColumn ? 0 : -1; })();
  const isSticky = (_meta: DataTableColumn<T>["meta"], index: number) => index === stickyIndex;

  const open = (row: LegacyRow<T>) => { const href = rowHref?.(row.original); if (href) router.push(href); };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,textarea,select,button,a,[role=combobox]") && !(e.target as HTMLElement).matches("tr")) return;
    if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setFocus((f) => Math.min(rows.length - 1, f + 1)); }
    else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
    else if (e.key === "Enter" && focus >= 0 && rows[focus]) open(rows[focus]);
  };

  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border bg-card", className)} data-overflow-left={edges.left || undefined} data-overflow-right={edges.right || undefined} onKeyDown={onKey} {...rest}>
      <div ref={scroller} className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h, hi) => {
                  const meta = (h.column.columnDef as DataTableColumn<T>).meta ?? {};
                  const sortable = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  const sticky = isSticky(meta, hi);
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                      style={meta.width ? { width: meta.width } : undefined}
                      className={cn(
                        "sticky top-0 z-20 h-9 bg-card px-3 py-0 text-left align-middle text-2xs font-semibold uppercase tracking-[0.06em] whitespace-nowrap text-foreground rule-ink",
                        meta.numeric && "text-right",
                        sticky && "left-0 z-30",
                        sticky && edges.left && "shadow-[inset_0_-1px_0_var(--rule-ink),6px_0_8px_-6px_rgba(23,23,23,.18)]",
                        meta.className,
                        "font-sans",
                      )}
                    >
                      {h.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className={cn("inline-flex h-9 items-center gap-1 rounded-sm align-middle font-[inherit] text-[length:inherit] tracking-[inherit] uppercase hover:text-foreground", meta.numeric && "ml-auto")}
                        >
                          {meta.numeric && <SortIcon dir={dir} />}
                          <span>{flexRender(h.column.columnDef.header, h.getContext())}</span>
                          {!meta.numeric && <SortIcon dir={dir} />}
                        </button>
                      ) : (
                        <span className="inline-flex h-9 items-center align-middle">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} className="p-0">{emptyState ?? <div className="py-10 text-center text-sm text-muted-foreground">—</div>}</td></tr>
            )}
            {rows.map((row, i) => {
              const stale = isStale?.(row.original) ?? false;
              const selected = isSelected?.(row.original) ?? false;
              const fresh = isNew?.(row.original) ?? false;
              const href = rowHref?.(row.original);
              // the 3px row bar lives on the first cell: a sticky cell paints over any <tr> shadow
              const bar = selected ? "var(--green-600)" : stale ? "var(--warning-border)" : fresh ? "var(--green-600)" : null;
              return (
                <tr
                  key={row.id}
                  tabIndex={0}
                  data-testid="data-row"
                  data-stale={stale || undefined}
                  {...rowProps?.(row.original)}
                  onFocus={() => setFocus(i)}
                  onClick={() => open(row)}
                  onMouseEnter={onRowHover ? () => onRowHover(row.original) : undefined}
                  onMouseLeave={onRowHover ? () => onRowHover(null) : undefined}
                  className={cn(
                    "group/row bg-card transition-colors duration-[120ms] outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    href && "cursor-pointer",
                    compact && "even:bg-[color-mix(in_srgb,var(--bg-surface-sunken)_60%,var(--card))] hover:even:bg-surface-sunken",
                    selected && "bg-green-50",
                    rowClassName?.(row.original),
                  )}
                >
                  {row.getVisibleCells().map((cell, ci) => {
                    const meta = (cell.column.columnDef as DataTableColumn<T>).meta ?? {};
                    const sticky = isSticky(meta, ci);
                    const shadows = [ci === 0 && bar ? `inset 3px 0 0 ${bar}` : null, sticky && edges.left ? "6px 0 8px -6px rgba(23,23,23,.18)" : null].filter(Boolean).join(", ");
                    return (
                      <td
                        key={cell.id}
                        style={shadows ? { boxShadow: shadows } : undefined}
                        className={cn(
                          "border-b border-hairline-faint px-3 align-middle whitespace-nowrap",
                          compact ? "h-9 py-1" : "h-10 py-1.5",
                          meta.numeric && "text-right font-mono text-[13px] tabular-nums",
                          meta.numeric && (meta.strong ? "font-medium text-foreground" : "text-ink-2"),
                          sticky && "sticky left-0 z-10 bg-inherit",
                          meta.className,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* scroll-edge cue: visible only while more columns sit off to the right */}
      <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 right-0 z-30 w-10 bg-gradient-to-l from-[rgba(23,23,23,.16)] to-transparent transition-opacity duration-200", edges.right ? "opacity-100" : "opacity-0")} />
      {edges.right && <span className="sr-only">More columns to the right; scroll sideways.</span>}
    </div>
  );
}

function SortIcon({ dir }: { dir: false | "asc" | "desc" }) {
  return dir === "asc" ? <ArrowUp className="size-3 shrink-0 text-foreground" /> : dir === "desc" ? <ArrowDown className="size-3 shrink-0 text-foreground" /> : <ArrowUpDown className="size-3 shrink-0 text-faint" />;
}

/** Two-line primary cell: name Figtree 14/500 + mono ref 12 muted below (DESIGN §5.4). Rows with it are 48px. */
export function PrimaryCell({ title, sub, className }: { title: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("max-w-[36ch] min-w-0 py-0.5", className)}>
      <div className="truncate font-sans text-sm leading-5 font-medium text-foreground" title={typeof title === "string" ? title : undefined}>{title}</div>
      {sub && <div className="truncate font-mono text-xs leading-4 text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Muted secondary line under a text cell (12px). `mono` for refs/numbers only. */
export function CellSub({ children, mono, className }: { children: React.ReactNode; mono?: boolean; className?: string }) {
  return <div className={cn("truncate text-xs leading-4 text-muted-foreground", mono ? "font-mono" : "font-sans", className)}>{children}</div>;
}
