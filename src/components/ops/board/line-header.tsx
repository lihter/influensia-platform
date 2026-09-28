"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import type { OpsLine } from "@/server/ops/participations";
import type { LineState } from "@/db/enums";
import { PageHeader, EyebrowLink } from "@/components/shared/page-header";
import { initials } from "@/lib/labels";
import { StateChip, MilestoneChip, ExceptionChip, UtilityBadge } from "@/components/shared/chips";
import { Age } from "@/components/shared/formatters";
import { FormShell } from "@/components/shared/form-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { changeLineStateAction } from "@/app/(ops)/ops/lines/[ref]/actions";
import { TABS, TAB_LABELS, S, type Tab } from "./strings";
import { useAction } from "./use-action";

/** Stage primary per DESIGN §6.8: one at a time. */
function stagePrimary(line: OpsLine): { label: string; tab: Tab } | null {
  switch (line.state) {
    case "submitted": case "in_review": return { label: S.header.freezeSpec, tab: "spec" };
    case "spec_frozen": case "cost_target_price": return { label: S.header.markRfq, tab: "sourcing" };
    case "rfq_out": case "quotes_in": case "shortlisted": case "negotiating": return { label: S.header.buildOffer, tab: "offer" };
    case "offer_ready": return line.offers.some((o) => o.status === "changes_requested" || o.status === "declined" || o.status === "expired") && !line.offers.some((o) => o.status === "sent") ? { label: S.header.sendOffer, tab: "offer" } : null;
    default: return null;
  }
}

export function LineHeader({ line, tab, me }: { line: OpsLine; tab: Tab; me: { id: string; role: string } }) {
  const ts = useTranslations("state");
  const tm = useTranslations("milestone");
  const primary = stagePrimary(line);
  const base = `/ops/lines/${line.ref}`;
  const sameWord = ts(line.state).toLowerCase() === tm(line.milestone).toLowerCase();
  return (
    <PageHeader
      sticky
      crumbs={[{ href: "/ops/requests", label: "Requests" }, { href: `/ops/requests/${line.request.ref}`, label: <span className="font-mono">{line.request.ref}</span> }, { label: <span className="font-mono" data-testid="line-ref">{line.ref}</span> }]}
      eyebrow={<><EyebrowLink href={`/ops/clients/${line.org.id}`}>{line.org.name}</EyebrowLink>{line.request.clientRef && <span className="normal-case tracking-normal"> · Client ref <span className="font-mono">{line.request.clientRef}</span></span>}</>}
      title={<span><span className="font-mono font-normal text-muted-foreground">{String(line.lineNo).padStart(2, "0")} ·</span> {line.name}</span>}
      meta={
        <>
          <span data-testid="line-state" data-state={line.state} className="inline-flex"><StateChip state={line.state} stale={line.stale} /></span>
          {!sameWord && <MilestoneChip milestone={line.milestone} waitingOnClient={line.waiting.party === "client"} />}
          {line.exception && <ExceptionChip exception={line.exception} />}
          {line.isRepeat && <UtilityBadge kind="repeat">Repeat</UtilityBadge>}
          {line.specVersion && <UtilityBadge kind="version">v{line.specVersion} frozen</UtilityBadge>}
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
            <span className={cn("flex size-6 items-center justify-center rounded-full bg-section-alt text-2xs font-semibold", line.agent?.id === me.id && "ring-2 ring-green-600")}>{line.agent ? initials(line.agent.name) : "—"}</span>
            {line.agent?.name ?? S.header.unassigned}
          </span>
          <span className="text-xs text-muted-foreground">{S.header.lastChange} <Age since={line.lastStateChangeAt} stale={line.stale} />{line.stale && <span className="ml-1 text-warning">· {S.header.stale}</span>}</span>
          {line.order && <Link href={`/ops/orders/${line.order.ref}`} className="link font-mono text-xs">{line.order.ref}</Link>}
        </>
      }
      actions={
        <>
          <ChangeStateSheet line={line} isAdmin={me.role === "admin"} />
          {primary && <Button asChild data-testid="stage-primary"><Link href={`${base}?tab=${primary.tab}`}>{primary.label}</Link></Button>}
        </>
      }
      tabs={
        <nav className="flex gap-6 overflow-x-auto" aria-label="Line tabs" data-testid="line-tabs">
          {TABS.map((t) => (
            <Link key={t} href={`${base}?tab=${t}`} aria-current={t === tab ? "page" : undefined} data-tab={t}
              className={cn("whitespace-nowrap border-b-2 pb-3 pt-2 text-sm transition-colors duration-[120ms]", t === tab ? "border-green-600 font-semibold text-foreground" : "border-transparent text-ink-2 hover:text-foreground")}>
              {TAB_LABELS[t]}{t === "sourcing" && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{line.participations.length}</span>}
            </Link>
          ))}
        </nav>
      }
    />
  );
}

function ChangeStateSheet({ line, isAdmin }: { line: OpsLine; isAdmin: boolean }) {
  const ts = useTranslations("state");
  const { run, pending } = useAction();
  // QA-07/QA-16b: preselect the first legal move so Submit never silently does nothing
  const [to, setTo] = React.useState<LineState | "">(line.allowedTransitions[0] ?? "");
  const [note, setNote] = React.useState("");
  const [override, setOverride] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const options: readonly LineState[] = override ? (["draft", "submitted", "in_review", "spec_frozen", "cost_target_price", "rfq_out", "quotes_in", "shortlisted", "negotiating", "offer_ready", "sampling", "offer_accepted"] as const) : line.allowedTransitions;
  return (
    <FormShell
      trigger={<Button variant="outline" data-testid="change-state" disabled={!!line.order}>{S.header.changeState}</Button>}
      open={open} onOpenChange={setOpen} eyebrow={line.ref} title={S.header.changeState} submitLabel={S.header.changeState} pending={pending}
      onSubmit={async () => {
        if (!to) return false;
        const r = await run(() => changeLineStateAction({ lineId: line.id, to, note: note || null, override: override || undefined, reason: reason || null }), { success: (d) => `${line.ref} → ${ts(d.to as LineState)}` });
        return r ? undefined : false;
      }}
    >
      <div className="flex flex-col gap-2">
        <Label>{S.header.allowed}</Label>
        {options.length === 0 && <p className="text-sm text-muted-foreground">{S.header.none}</p>}
        {options.length > 0 && !to && <p className="text-xs text-muted-foreground" data-testid="change-state-hint">Pick the state to move to.</p>}
        <div role="radiogroup" className="sheet">
          {options.map((s) => (
            <label key={s} className={cn("sheet-row flex cursor-pointer items-center gap-3 text-sm hover:bg-surface-sunken", to === s && "bg-green-50")}>
              <input type="radio" name="to" value={s} checked={to === s} onChange={() => setTo(s)} className="accent-green-600" />
              <span className="font-medium text-foreground">{ts(s)}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cs-note">{S.header.note}</Label>
        <Textarea id="cs-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {isAdmin && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-hairline-strong p-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="accent-green-600" />{S.header.override}</label>
          {override && <Textarea rows={2} placeholder={S.header.reason} value={reason} onChange={(e) => setReason(e.target.value)} required />}
        </div>
      )}
      {pending && <Loader2 className="animate-spin" />}
    </FormShell>
  );
}
