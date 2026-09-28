import { useTranslations } from "next-intl";
import { Factory, EyeOff, Eye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * DESIGN §5.14 — "Factory F-0042" in a dashed mono chip. This component deliberately has NO supplier-name prop:
 * the client bundle can only ever render the label. Ops pages render the supplier name themselves and add this chip
 * with `disclosed` to mean "shown to client as" / "disclosed".
 */
export function FactoryLabel({ label, disclosed, className }: { label: string; /** ops: solid chip with Eye when disclosed_to_org_ids includes the client */ disclosed?: boolean; className?: string }) {
  const t = useTranslations("common");
  const text = t("factory", { label: label.replace(/^Factory\s+/i, "") });
  const chip = (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-md border bg-card px-2 font-mono text-xs text-foreground",
        disclosed ? "border-neutral-border bg-neutral-wash" : "border-dashed border-hairline-strong",
        className,
      )}
      data-testid="factory-label"
    >
      {disclosed === undefined ? <Factory className="size-3 text-muted-foreground" /> : disclosed ? <Eye className="size-3 text-muted-foreground" /> : <EyeOff className="size-3 text-muted-foreground" />}
      {text}
    </span>
  );
  if (disclosed !== undefined) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent>{t("factoryTooltip")}</TooltipContent>
    </Tooltip>
  );
}
