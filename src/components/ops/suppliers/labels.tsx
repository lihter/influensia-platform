import { Factory, Store, Blend, HelpCircle, CircleDashed, Mail, MessageCircle, Globe, Phone, ShoppingBag, Boxes, Smartphone, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SupplierTypeVerdict, VerdictSource, ContactChannel, SupplierGrade } from "@/db/enums";

/* Local strings for the suppliers slice (messages/en.json is foundation-owned; these are ops-only labels). */
export const VERDICT_LABEL: Record<SupplierTypeVerdict, string> = { manufacturer: "Manufacturer", trading: "Trading", hybrid: "Hybrid", unknown: "Unknown", unchecked: "Unchecked" };
export const VERDICT_ICON: Record<SupplierTypeVerdict, LucideIcon> = { manufacturer: Factory, trading: Store, hybrid: Blend, unknown: HelpCircle, unchecked: CircleDashed };
export const SOURCE_LABEL: Record<VerdictSource, string> = { baidu: "Baidu", qcc: "企查查 (QCC)", alibaba_profile: "Alibaba profile", site_visit: "Site visit", sheet_import: "Sheet import", other: "Other" };
export const CHANNEL_LABEL: Record<ContactChannel, string> = { alibaba: "Alibaba", "1688": "1688", wechat: "WeChat", email: "Email", global_sources: "Global Sources", web: "Web", whatsapp: "WhatsApp", phone: "Phone" };
export const CHANNEL_ICON: Record<ContactChannel, LucideIcon> = { alibaba: ShoppingBag, "1688": Boxes, wechat: MessageCircle, email: Mail, global_sources: Globe, web: Globe, whatsapp: Smartphone, phone: Phone };
export const GRADE_HINT: Record<SupplierGrade, string> = { A: "A — verified factory, export track record", B: "B — factory, checks pass", C: "C — plausible, gaps to verify", D: "D — trader / young / weak record", E: "E — do not use" };

export function VerdictChip({ verdict, className }: { verdict: SupplierTypeVerdict; className?: string }) {
  const Icon = VERDICT_ICON[verdict];
  // "Unchecked" is the absence of a verdict: faint text, no chip (DESIGN §6.11), so real verdicts carry the weight.
  if (verdict === "unchecked") return <span className={cn("inline-flex items-center gap-1 text-xs text-faint", className)} data-verdict={verdict}><Icon className="size-3" />Not checked</span>;
  return (
    <Badge variant={verdict === "trading" ? "warning" : "neutral"} className={className} data-verdict={verdict}>
      <Icon className="size-3" />
      {VERDICT_LABEL[verdict]}
    </Badge>
  );
}

/** Grade in a 22px circle (DESIGN §6.11). */
export function GradeCircle({ grade, className }: { grade: SupplierGrade | null; className?: string }) {
  if (!grade) return <span className={cn("text-faint", className)}>—</span>;
  const tone = grade === "A" || grade === "B" ? "border-success-border bg-success-wash text-success" : grade === "C" ? "border-neutral-border bg-neutral-wash text-neutral" : grade === "D" ? "border-warning-border bg-warning-wash text-warning" : "border-danger-border bg-danger-wash text-danger";
  return <span title={GRADE_HINT[grade]} className={cn("inline-flex size-[22px] items-center justify-center rounded-full border font-mono text-xs font-medium", tone, className)} data-grade={grade}>{grade}</span>;
}

export function ChannelIcons({ channels, className, size = "sm" }: { channels: ContactChannel[]; className?: string; size?: "xs" | "sm" }) {
  if (!channels.length) return size === "xs" ? null : <span className="text-faint">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label={`Channels: ${channels.map((c) => CHANNEL_LABEL[c]).join(", ")}`}>
      {channels.map((c) => {
        const Icon = CHANNEL_ICON[c];
        // 1688 has no readable glyph: show the digits as a text badge
        if (c === "1688") return <span key={c} title={CHANNEL_LABEL[c]} className={cn("inline-flex items-center justify-center rounded-md bg-section-alt px-1 font-mono font-semibold text-ink-2", size === "xs" ? "h-5 text-[9px]" : "h-6 text-[10px]")}>1688</span>;
        return <span key={c} title={CHANNEL_LABEL[c]} className={cn("inline-flex items-center justify-center rounded-md bg-section-alt text-ink-2", size === "xs" ? "size-5" : "size-6")}><Icon className={size === "xs" ? "size-3" : "size-3.5"} strokeWidth={1.75} /></span>;
      })}
    </span>
  );
}

export function ChannelBadge({ channel, className }: { channel: ContactChannel; className?: string }) {
  const Icon = CHANNEL_ICON[channel];
  return <Badge variant="neutral" className={cn("normal-case tracking-normal", className)}><Icon className="size-3" />{CHANNEL_LABEL[channel]}</Badge>;
}
