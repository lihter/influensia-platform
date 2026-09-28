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
  density?: "default" | "compact";
  emptyState?: React.ReactNode;
  /** default sort */
  initialSorting?: SortingState;
  /** global filter string (wire to a search input in the toolbar) */
  globalFilter?: string;
  /** cap the container height so the header sticks inside it (ops) */
  maxHeight?: string;
  className?: string;
  "data-testid"?: string;
};

/**
 * DESIGN §5.4 — dense TanStack table: sticky uppercase header with the 1px ink rule, 40/36px rows, mono numeric columns,
 * hover/selected/stale/new row treatments, whole-row links, keyboard J/K/Enter.
 */
export function DataTable<T extends RowData>({ columns, data, rowHref, isStale, isSelected, isNew, rowClassName, density = "default", emptyState, initialSorting, globalFilter, maxHeight, className, ...rest }: DataTableProps<T>) {
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

  const open = (row: LegacyRow<T>) => { const href = rowHref?.(row.original); if (href) router.push(href); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setFocus((f) => Math.min(rows.length - 1, f + 1)); }
    else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
    else if (e.key === "Enter" && focus >= 0 && rows[focus]) open(rows[focus]);
  };

  return (
    <div className={cn("overflow-auto rounded-xl border border-border bg-card", className)} style={maxHeight ? { maxHeight } : undefined} onKeyDown={onKey} {...rest}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const meta = (h.column.columnDef as DataTableColumn<T>).meta ?? {};
                const sortable = h.column.getCanSort();
                const dir = h.column.getIsSorted();
                return (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                    style={meta.width ? { width: meta.width } : undefined}
                    className={cn(
                      "sticky top-0 z-20 h-9 bg-card px-3 text-left align-bottom text-2xs font-semibold uppercase tracking-[0.06em] whitespace-nowrap text-foreground rule-ink",
                      meta.numeric && "text-right",
                      meta.sticky && "left-0 z-30",
                      meta.className,
                    )}
                  >
                    {h.isPlaceholder ? null : sortable ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className={cn("inline-flex items-center gap-1 rounded-sm hover:text-foreground", meta.numeric && "flex-row-reverse")}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? <ArrowUp className="size-3 text-foreground" /> : dir === "desc" ? <ArrowDown className="size-3 text-foreground" /> : <ArrowUpDown className="size-3 text-faint" />}
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
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
            return (
              <tr
                key={row.id}
                tabIndex={0}
                data-testid="data-row"
                data-stale={stale || undefined}
                onFocus={() => setFocus(i)}
                onClick={() => open(row)}
                className={cn(
                  "group/row transition-colors duration-[120ms] outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  href && "cursor-pointer",
                  compact && "even:bg-surface-sunken/60",
                  selected && "bg-green-50 shadow-[inset_3px_0_0_var(--green-600)]",
                  !selected && stale && "shadow-[inset_3px_0_0_var(--warning-border)]",
                  !selected && !stale && fresh && "shadow-[inset_3px_0_0_var(--green-600)]",
                  rowClassName?.(row.original),
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = (cell.column.columnDef as DataTableColumn<T>).meta ?? {};
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "border-b border-hairline-faint px-3 py-0 align-middle whitespace-nowrap",
                        compact ? "h-9" : "h-10",
                        meta.numeric && "text-right font-mono text-[13px] tabular-nums",
                        meta.numeric && (meta.strong ? "font-medium text-foreground" : "text-ink-2"),
                        meta.sticky && "sticky left-0 z-10 bg-card group-hover/row:bg-surface-sunken",
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
  );
}

/** Two-line primary cell: name 14/500 + mono ref below (DESIGN §5.4). */
export function PrimaryCell({ title, sub, className }: { title: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("max-w-[32ch] min-w-0", className)}>
      <div className="truncate font-medium text-foreground" title={typeof title === "string" ? title : undefined}>{title}</div>
      {sub && <div className="truncate font-mono text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
