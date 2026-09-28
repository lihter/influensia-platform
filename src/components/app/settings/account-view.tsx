"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Check, Loader2, Lock } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/format-date";
import type { ActionResult } from "@/server/shared/http";
import { PasswordInput, type ClientAccountDto, type ProfileInput } from "@/server/client/dto/settings";

/** Client-facing strings: never "organisation/organization/supplier/factory" (SPEC 1.3, AC-SHELL-01). */
const T = {
  profile: "Your profile",
  name: "Name",
  email: "Email",
  emailHint: "To change your sign-in email, ask your Influensia contact.",
  saveName: "Save",
  company: "Company details",
  companyHint: "Shown on offers and invoices. Ask your Influensia contact to change these.",
  password: "Password",
  passwordHint: "At least 10 characters with a letter and a digit.",
  current: "Current password",
  next: "New password",
  confirm: "Confirm new password",
  changePassword: "Change password",
  passwordChanged: "Password changed",
  passwordWrong: "Current password is incorrect",
  setPasswordNudge: "You are still using the temporary password from your invitation — set your own below.",
  notifications: "Email notifications",
  notificationsHint: "Emails about your orders go to",
  required: "Always on",
  team: "Your team",
  errors: { E_VALIDATION: "Check the highlighted fields", E_INTERNAL: "Something went wrong", E_FORBIDDEN: "Not allowed", E_UNAUTHORIZED: "Sign in again", E_NOT_FOUND: "Not found" } as Record<string, string>,
};
const err = (c: string) => T.errors[c] ?? c;

function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="flex items-center gap-1 text-xs text-danger" role="alert"><AlertCircle className="size-3" />{msg}</p> : null;
}

function Card({ title, hint, children, testId }: { title: string; hint?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-label={title} data-testid={testId}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ProfileCard({ dto, save }: { dto: ClientAccountDto; save: (i: ProfileInput) => Promise<ActionResult<{ name: string }>> }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | undefined>();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    setError(undefined);
    start(async () => {
      const r = await save({ name });
      if (!r.ok) { setError(r.errors?.name ?? err(r.error)); return; }
      toast.success("Name saved");
      router.refresh();
    });
  };
  return (
    <Card title={T.profile} testId="profile-card">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name" className="text-xs font-medium text-ink-2">{T.name}</Label>
          <Input id="name" name="name" defaultValue={dto.name} required className="h-10" aria-invalid={error ? true : undefined} />
          <FieldError msg={error} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email" className="text-xs font-medium text-ink-2">{T.email}</Label>
          <Input id="email" value={dto.email} readOnly disabled className="h-10" />
          <p className="text-xs text-muted-foreground">{T.emailHint}</p>
        </div>
        <div className="flex justify-end"><Button type="submit" disabled={pending} data-testid="save-name">{pending && <Loader2 className="animate-spin" />}{T.saveName}</Button></div>
      </form>
    </Card>
  );
}

export function CompanyCard({ dto }: { dto: ClientAccountDto }) {
  const c = dto.company;
  const rows: [string, React.ReactNode, boolean?][] = [
    ["Company", c.name], ["Country", c.country ?? "—", true], ["VAT id", c.vatId ?? "—", true], ["Prices shown", c.pricingDisplay === "all_in" ? "All-in price" : "Unit price + service fee"],
    ["Currency", c.currencyDisplay, true], ["Delivery terms", c.defaultIncoterm, true], ["Timezone", c.timezone, true], ["Language", c.language.toUpperCase(), true],
  ];
  return (
    <Card title={T.company} hint={T.companyHint} testId="company-card">
      <dl className="-mx-5 divide-y divide-hairline-faint border-t border-hairline-faint">
        {rows.map(([k, v, mono]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-sm">
            <dt className="text-xs font-medium text-muted-foreground">{k}</dt>
            <dd className={mono ? "font-mono text-[13px] tabular-nums text-foreground" : "text-foreground"}>{v}</dd>
          </div>
        ))}
      </dl>
      {dto.teammates.length > 0 && (
        <div className="mt-4">
          <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{T.team}</div>
          <ul className="mt-2 divide-y divide-hairline-faint">
            {dto.teammates.map((m) => (
              <li key={m.email} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span><span className="font-medium text-foreground">{m.name}</span> <span className="text-muted-foreground">{m.email}</span></span>
                <Badge variant={m.status === "active" ? "success" : "info"}>{m.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Better Auth client `changePassword` (current required, SPEC F-01); then the server marks the invite consumed. */
export function PasswordCard({ dto, done }: { dto: ClientAccountDto; done: () => Promise<ActionResult<undefined>> }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const formRef = React.useRef<HTMLFormElement>(null);
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    const parsed = PasswordInput.safeParse(v);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0] ?? "_")] = i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setPending(true);
    const { error } = await authClient.changePassword({ currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword, revokeOtherSessions: true });
    if (error) {
      setErrors({ currentPassword: error.status === 400 || error.code === "INVALID_PASSWORD" ? T.passwordWrong : (error.message ?? T.errors.E_INTERNAL) });
      setPending(false);
      return;
    }
    const r = await done();
    setPending(false);
    if (!r.ok) { toast.error(err(r.error)); return; }
    toast.success(T.passwordChanged);
    formRef.current?.reset();
    router.refresh();
  };
  return (
    <Card title={T.password} hint={T.passwordHint} testId="password-card">
      {!dto.passwordSetAt && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-wash px-3 py-2 text-sm text-warning" data-testid="temp-password-nudge"><Lock className="mt-0.5 size-4 shrink-0" />{T.setPasswordNudge}</p>
      )}
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {(["currentPassword", "newPassword", "confirm"] as const).map((k) => (
          <div key={k} className="flex flex-col gap-1.5">
            <Label htmlFor={k} className="text-xs font-medium text-ink-2">{k === "currentPassword" ? T.current : k === "newPassword" ? T.next : T.confirm}</Label>
            <Input id={k} name={k} type="password" autoComplete={k === "currentPassword" ? "current-password" : "new-password"} required className="h-10" aria-invalid={errors[k] ? true : undefined} />
            <FieldError msg={errors[k]} />
          </div>
        ))}
        <div className="flex justify-end"><Button type="submit" disabled={pending} data-testid="change-password">{pending && <Loader2 className="animate-spin" />}{T.changePassword}</Button></div>
      </form>
      {dto.passwordSetAt && <p className="mt-3 text-xs text-muted-foreground">Last changed {fmtDate(dto.passwordSetAt)}</p>}
    </Card>
  );
}

/** v1 stub (D-09): action-needed emails cannot be muted; other rows show the rule and no working toggle yet. */
export function NotificationsCard({ dto }: { dto: ClientAccountDto }) {
  return (
    <Card title={T.notifications} hint={`${T.notificationsHint} ${dto.email}.`} testId="notifications-card">
      <ul className="-mx-5 divide-y divide-hairline-faint border-t border-hairline-faint" data-testid="notification-prefs">
        {dto.notifications.map((n) => (
          <li key={n.key} className="flex items-start justify-between gap-4 px-5 py-3" data-pref={n.key} data-required={n.required || undefined}>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{n.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{n.description}</div>
            </div>
            {n.required ? (
              <Badge variant="outline" className="shrink-0"><Check className="size-3" />{T.required}</Badge>
            ) : (
              <span className="shrink-0 inline-flex items-center gap-2 text-xs text-muted-foreground" title="Muting arrives in a later version">
                <span className="relative inline-flex h-5 w-9 items-center rounded-full bg-foreground opacity-50" aria-label={`${n.label} on`} role="switch" aria-checked="true" aria-disabled="true">
                  <span className="absolute right-0.5 size-4 rounded-full bg-white" />
                </span>
                On
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
