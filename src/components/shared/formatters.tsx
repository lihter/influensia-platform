import { cn } from "@/lib/utils";
import { formatMoney, formatUnitPrice, formatQty, formatPct } from "@/server/shared/money";
import { formatDate, formatDateShort, formatDateTime, formatIso, ageLabel } from "@/server/shared/dates";

const mono = "font-mono tabular-nums";

/** `$6,740.00` — totals, always 2 dp. */
export function Money({ minor, currency = "USD", className, strong }: { minor: number; currency?: string; className?: string; strong?: boolean }) {
  return <span className={cn(mono, strong ? "font-medium text-foreground" : "text-ink-2", className)}>{formatMoney({ minor, currency })}</span>;
}

/** `$0.0539 / pc` with the unit muted; `plusFee` appends "+ fee" (factory_plus_fee display). */
export function UnitPrice({ minorE2, currency = "USD", unit, decimals, plusFee, feeMinor, className, size = "sm" }: { minorE2: number; currency?: string; unit?: string; decimals?: number; plusFee?: boolean; feeMinor?: number; className?: string; size?: "sm" | "lg" }) {
  return (
    <span className={cn(mono, "font-medium text-foreground", size === "lg" && "text-[1.25rem] leading-7 tracking-[-0.01em]", className)}>
      {formatUnitPrice({ minorE2, currency }, { decimals, withUnit: false })}
      {unit && <span className="font-normal text-muted-foreground"> / {unit}</span>}
      {plusFee && <span className="text-[0.8125rem] font-normal text-ink-2"> + {feeMinor !== undefined ? formatMoney({ minor: feeMinor, currency }) + " " : ""}fee</span>}
    </span>
  );
}

export function Qty({ qty, unit, className }: { qty: number; unit?: string; className?: string }) {
  return <span className={cn(mono, className)}>{formatQty(qty, unit)}</span>;
}

export function Pct({ pct, signed, className }: { pct: number; signed?: boolean; className?: string }) {
  return <span className={cn(mono, className)}>{formatPct(pct, { signed })}</span>;
}

/** Dates: `22 Sep 2026` (prose) / `22 Sep` (short) / with time; ISO in the title tooltip. */
export function DateTime({ value, variant = "date", className }: { value: Date | string | null | undefined; variant?: "date" | "short" | "datetime"; className?: string }) {
  const text = variant === "short" ? formatDateShort(value) : variant === "datetime" ? formatDateTime(value) : formatDate(value);
  return <time dateTime={formatIso(value)} title={formatIso(value)} className={cn(mono, className)}>{text}</time>;
}

/** `15 d` — age since a timestamp; amber + bold when stale. */
export function Age({ since, stale, className }: { since: Date | string; stale?: boolean; className?: string }) {
  return <span className={cn(mono, stale ? "font-medium text-warning" : "text-ink-2", className)} title={formatIso(since)}>{ageLabel(since)}</span>;
}

/** Reference in mono (REQ-2026-0312). */
export function Ref({ children, className, muted }: { children: React.ReactNode; className?: string; muted?: boolean }) {
  return <span className={cn(mono, "text-xs", muted ? "text-muted-foreground" : "text-foreground", className)}>{children}</span>;
}
