"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/server/shared/http";
import type { ClientOrgRow, ClientSettingsInput } from "@/server/ops/clients";
import { TextField, SelectField, DefRow } from "./fields";
import { S, COMMERCIAL_MODE_OPTIONS, PRICING_DISPLAY_OPTIONS, INCOTERM_OPTIONS, LANGUAGE_OPTIONS, TIMEZONE_OPTIONS, COMMERCIAL_MODE_LABEL, PRICING_DISPLAY_LABEL, LANGUAGE_LABEL, errorText } from "./strings";

type Save = (input: { orgId: string } & ClientSettingsInput) => Promise<ActionResult<{ changed: string[] }>>;

/** F-26 Settings card: inline form for admins (AC-CLI-03: read-only definition rows for agents). */
export function ClientSettingsCard({ org, admin, save }: { org: ClientOrgRow; admin: boolean; save: Save }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  if (!admin) {
    return (
      <div className="sheet" data-testid="client-settings-readonly">
        <dl className="divide-y divide-hairline-faint">
          <DefRow label={S.sheet.orgName}>{org.name}</DefRow>
          <DefRow label={S.sheet.country} mono>{org.country}</DefRow>
          <DefRow label={S.sheet.vatId} mono>{org.vatId}</DefRow>
          <DefRow label={S.sheet.commercialMode}>{COMMERCIAL_MODE_LABEL[org.commercialMode]}</DefRow>
          <DefRow label={S.sheet.pricingDisplay}>{PRICING_DISPLAY_LABEL[org.pricingDisplay]}</DefRow>
          <DefRow label={S.sheet.incoterm} mono>{org.defaultIncoterm}</DefRow>
          <DefRow label="Deposit" mono>{org.depositPct} %</DefRow>
          <DefRow label="Currency display" mono>{org.currencyDisplay}</DefRow>
          <DefRow label={S.sheet.language}>{LANGUAGE_LABEL[org.language] ?? org.language}</DefRow>
          <DefRow label="Timezone" mono>{org.timezone}</DefRow>
        </dl>
        <p className="px-4 py-2.5 text-xs text-muted-foreground">{S.detail.readOnly}</p>
      </div>
    );
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = Object.fromEntries(fd.entries()) as Record<string, string>;
    setErrors({});
    start(async () => {
      const r = await save({
        orgId: org.id, name: v.name, country: v.country, vatId: v.vatId, commercialMode: v.commercialMode as ClientSettingsInput["commercialMode"],
        pricingDisplay: v.pricingDisplay as ClientSettingsInput["pricingDisplay"], defaultIncoterm: v.defaultIncoterm as ClientSettingsInput["defaultIncoterm"],
        depositPct: v.depositPct, language: v.language as ClientSettingsInput["language"], timezone: v.timezone,
      });
      if (!r.ok) { setErrors(r.errors ?? {}); toast.error(errorText(r.error)); return; }
      toast.success(r.data.changed.length ? S.toast.saved : S.toast.noChange);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-5" data-testid="client-settings-form">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <TextField id="name" label={S.sheet.orgName} defaultValue={org.name} error={errors.name} required />
        <TextField id="country" label={S.sheet.country} defaultValue={org.country ?? ""} error={errors.country} maxLength={2} className="[&_input]:font-mono [&_input]:uppercase" />
        <TextField id="vatId" label={S.sheet.vatId} defaultValue={org.vatId ?? ""} error={errors.vatId} optional className="[&_input]:font-mono" />
        <SelectField id="commercialMode" label={S.sheet.commercialMode} options={COMMERCIAL_MODE_OPTIONS} defaultValue={org.commercialMode} error={errors.commercialMode} hint={S.sheet.modeHint} />
        <SelectField id="pricingDisplay" label={S.sheet.pricingDisplay} options={PRICING_DISPLAY_OPTIONS} defaultValue={org.pricingDisplay} error={errors.pricingDisplay} />
        <SelectField id="defaultIncoterm" label={S.sheet.incoterm} options={INCOTERM_OPTIONS} defaultValue={org.defaultIncoterm} error={errors.defaultIncoterm} />
        <TextField id="depositPct" label="Deposit %" type="number" inputMode="numeric" min={0} max={100} defaultValue={org.depositPct} error={errors.depositPct} className="[&_input]:font-mono [&_input]:text-right" />
        <SelectField id="language" label={S.sheet.language} options={LANGUAGE_OPTIONS} defaultValue={org.language} error={errors.language} />
        <SelectField id="timezone" label="Timezone" options={TIMEZONE_OPTIONS.some((o) => o.value === org.timezone) ? TIMEZONE_OPTIONS : [{ value: org.timezone, label: org.timezone }, ...TIMEZONE_OPTIONS]} defaultValue={org.timezone} error={errors.timezone} />
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-hairline-faint pt-4">
        <p className="text-xs text-muted-foreground">Currency display is fixed to <span className="font-mono">{org.currencyDisplay}</span> in v1.</p>
        <Button type="submit" disabled={pending} data-testid="save-settings">{pending && <Loader2 className="animate-spin" />}{S.detail.save}</Button>
      </div>
    </form>
  );
}
