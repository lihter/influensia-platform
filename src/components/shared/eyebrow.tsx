import { cn } from "@/lib/utils";

/**
 * DESIGN §5.7. `plain` = muted uppercase label; `pill` = brand green pill. `number` renders "01 —" in mono.
 */
export function Eyebrow({ children, variant = "plain", number, className, as: Tag = "div" }: { children: React.ReactNode; variant?: "plain" | "pill"; number?: string | number; className?: string; as?: "div" | "span" | "p" }) {
  if (variant === "pill") {
    return (
      <Tag className={cn("inline-flex h-[22px] items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 text-2xs font-semibold uppercase tracking-[0.08em] text-green-700", className)}>
        {number !== undefined && <span className="font-mono font-medium">{String(number).padStart(2, "0")} —</span>}
        {children}
      </Tag>
    );
  }
  return (
    <Tag className={cn("text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground", className)}>
      {number !== undefined && <span className="font-mono font-medium">{String(number).padStart(2, "0")} · </span>}
      {children}
    </Tag>
  );
}
