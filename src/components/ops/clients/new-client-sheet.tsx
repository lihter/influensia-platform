"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { FormShell } from "@/components/shared/form-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/server/shared/http";
import type { CreateClientInput } from "@/server/ops/clients";
import type { CreatedClient } from "@/app/(ops)/ops/clients/actions";
import { Field, TextField, SelectField } from "./fields";
import { InviteResultDialog, type InviteCredentials } from "./invite-result";
import { S, COMMERCIAL_MODE_OPTIONS, PRICING_DISPLAY_OPTIONS, INCOTERM_OPTIONS, LANGUAGE_OPTIONS, errorText } from "./strings";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

/** F-26 "+ Client": org + first client_owner in one sheet; then the one-time credentials dialog (local mode). */
export function NewClientSheet({ create }: { create: (input: CreateClientInput) => Promise<ActionResult<CreatedClient>> }) {
  const router = useRouter();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [creds, setCreds] = React.useState<InviteCredentials | null>(null);
  const [open, setOpen] = React.useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    const fd = new FormData(e.currentTarget);
    const input = Object.fromEntries(fd.entries()) as Record<string, string>;
    setErrors({});
    const r = await create({
      orgName: input.orgName, country: input.country, vatId: input.vatId, userName: input.userName, email: input.email,
      commercialMode: input.commercialMode as CreateClientInput["commercialMode"], pricingDisplay: input.pricingDisplay as CreateClientInput["pricingDisplay"],
      defaultIncoterm: input.defaultIncoterm as CreateClientInput["defaultIncoterm"], language: input.language as CreateClientInput["language"],
    });
    if (!r.ok) {
      setErrors(r.errors ?? {});
      toast.error(errorText(r.error));
      return false;
    }
    toast.success(S.toast.created(input.orgName));
    setCreds({ email: r.data.email, tempPassword: r.data.tempPassword, inviteToken: r.data.inviteToken, orgId: r.data.orgId });
    router.refresh();
  };

  return (
    <>
      <FormShell
        open={open} onOpenChange={(o) => { setOpen(o); if (!o) setErrors({}); }}
        trigger={<Button data-testid="new-client"><Plus />{S.newClient}</Button>}
        eyebrow={S.eyebrow} title={S.sheet.title} description={S.sheet.description} submitLabel={S.sheet.submit} onSubmit={onSubmit}
      >
        <Group title={S.sheet.org}>
          <TextField id="orgName" label={S.sheet.orgName} error={errors.orgName} required autoFocus placeholder="Pevex" />
          <div className="grid grid-cols-2 gap-4">
            <TextField id="country" label={S.sheet.country} error={errors.country} required maxLength={2} placeholder="HR" className="[&_input]:font-mono [&_input]:uppercase" />
            <TextField id="vatId" label={S.sheet.vatId} error={errors.vatId} optional placeholder="HR12345678901" className="[&_input]:font-mono" />
          </div>
        </Group>
        <Group title={S.sheet.user}>
          <TextField id="userName" label={S.sheet.userName} error={errors.userName} required placeholder="Ana Horvat" />
          <TextField id="email" label={S.sheet.email} error={errors.email} required type="email" placeholder="ana@pevex.hr" />
          <Field id="role" label={S.sheet.role}>
            <Input id="role" value={S.sheet.roleFixed} readOnly disabled />
          </Field>
        </Group>
        <Group title={S.sheet.commercial}>
          <div className="grid grid-cols-2 gap-4">
            <SelectField id="commercialMode" label={S.sheet.commercialMode} options={COMMERCIAL_MODE_OPTIONS} defaultValue="agency_passthrough" error={errors.commercialMode} />
            <SelectField id="pricingDisplay" label={S.sheet.pricingDisplay} options={PRICING_DISPLAY_OPTIONS} defaultValue="factory_plus_fee" error={errors.pricingDisplay} />
            <SelectField id="defaultIncoterm" label={S.sheet.incoterm} options={INCOTERM_OPTIONS} defaultValue="FOB" error={errors.defaultIncoterm} />
            <SelectField id="language" label={S.sheet.language} options={LANGUAGE_OPTIONS} defaultValue="en" error={errors.language} />
          </div>
          <p className="text-xs text-muted-foreground">{S.sheet.modeHint} Currency display is USD, deposit 30 % — change them on the client page.</p>
        </Group>
      </FormShell>
      <InviteResultDialog creds={creds} onClose={() => setCreds(null)} showOpen />
    </>
  );
}
