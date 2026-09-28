import { useTranslations } from "next-intl";
import { Check, Clock, Star, Triangle, X, Eye, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LineState, Milestone, ParticipationStatus, OfferStatus, SampleStatus, PaymentStatus, LineException, Visibility } from "@/db/enums";
import { STATE_TONE, PARTICIPATION_TONE, OFFER_TONE, SAMPLE_TONE, PAYMENT_TONE, EXCEPTION_TONE, type Tone } from "./state-tone";

const toneVariant = (t: Tone) => (t === "dashed" ? "dashed" : t === "outline" ? "outline" : t);

/** DESIGN §5.3-B — internal state chip (ops). `stale` adds the trailing amber clock. */
export function StateChip({ state, stale, className }: { state: LineState; stale?: boolean; className?: string }) {
  const t = useTranslations("state");
  return (
    <Badge variant={toneVariant(STATE_TONE[state])} className={cn(className)} data-state={state}>
      {t(state)}
      {stale && <Clock className="size-3 text-warning" aria-label="stale" />}
    </Badge>
  );
}

/** DESIGN §5.3-A — client milestone pill: calm neutral; green with ▲ when the client owes the move; success when delivered. */
export function MilestoneChip({ milestone, waitingOnClient, className, showStep }: { milestone: Milestone; waitingOnClient?: boolean; className?: string; showStep?: number }) {
  const t = useTranslations("milestone");
  const delivered = milestone === "delivered";
  return (
    <span
      data-milestone={milestone}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        delivered ? "border-success-border bg-success-wash text-success" : waitingOnClient ? "border-green-200 bg-green-100 text-green-700" : "border-neutral-border bg-neutral-wash text-ink-2",
        className,
      )}
    >
      {waitingOnClient && !delivered && <Triangle className="size-2 fill-current" aria-label={t("yourAction")} />}
      {t(milestone)}
      {showStep !== undefined && <span className="font-mono text-2xs text-muted-foreground">{t("stepOf", { step: showStep })}</span>}
    </span>
  );
}

/** DESIGN §5.3-C — sourcing board participation status. */
export function ParticipationChip({ status, className }: { status: ParticipationStatus; className?: string }) {
  const t = useTranslations("participation_status");
  const tone = PARTICIPATION_TONE[status];
  return (
    <Badge
      variant={toneVariant(tone)}
      data-status={status}
      className={cn(
        status === "selected" && "border-green-700 bg-green-700 text-white",
        status === "backup" && "border-green-600 bg-transparent text-green-700",
        status === "dropped" && "border-border bg-transparent text-muted-foreground line-through",
        status === "contacted" && "text-ink-2",
        className,
      )}
    >
      {status === "shortlisted" && <Star className="size-3" />}
      {status === "selected" && <Check className="size-3" />}
      {status === "cannot_make" && <X className="size-3" />}
      {t(status)}
    </Badge>
  );
}

export function ExceptionChip({ exception, client, className }: { exception: LineException; client?: boolean; className?: string }) {
  const t = useTranslations("exception");
  return <Badge variant={toneVariant(EXCEPTION_TONE[exception])} className={cn(client && "normal-case tracking-normal", className)}>{client ? t(`client.${exception}`) : t(exception)}</Badge>;
}

export function OfferStatusChip({ status, className }: { status: OfferStatus; className?: string }) {
  const t = useTranslations("offer_status");
  return <Badge variant={toneVariant(OFFER_TONE[status])} className={className}>{t(status)}</Badge>;
}
export function SampleStatusChip({ status, className }: { status: SampleStatus; className?: string }) {
  const t = useTranslations("sample_status");
  return <Badge variant={toneVariant(SAMPLE_TONE[status])} className={className}>{t(status)}</Badge>;
}
export function PaymentStatusChip({ status, className }: { status: PaymentStatus; className?: string }) {
  const t = useTranslations("payment_status");
  return <Badge variant={toneVariant(PAYMENT_TONE[status])} className={className}>{t(status)}</Badge>;
}

/** DESIGN §5.11 — Client / Internal visibility badge. */
export function VisibilityBadge({ visibility, className }: { visibility: Visibility; className?: string }) {
  const t = useTranslations("visibility");
  return visibility === "client" ? (
    <Badge variant="green" className={className}><Eye className="size-3" />{t("client")}</Badge>
  ) : (
    <Badge variant="neutral" className={className}><EyeOff className="size-3" />{t("internal")}</Badge>
  );
}

/** Small utility badges (DESIGN §5.3-D). */
export function UtilityBadge({ kind, children, className }: { kind: "repeat" | "catalog" | "range" | "recommended" | "version" | "draft"; children?: React.ReactNode; className?: string }) {
  const variant = kind === "repeat" || kind === "catalog" || kind === "range" ? "info" : kind === "recommended" ? "green" : kind === "version" ? "outline" : "neutral";
  return <Badge variant={variant} className={cn(kind === "version" && "font-mono normal-case tracking-normal", className)}>{children}</Badge>;
}
