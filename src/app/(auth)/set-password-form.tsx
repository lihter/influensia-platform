"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordProblem } from "@/server/client/dto/settings";

type Result = { ok: true } | { ok: false; message: string };

/** Shared by /reset-password and /invite/[token]: new password + confirm, one rule message at a time (QA-41). */
export function SetPasswordForm({ submit, submitLabel, email }: { submit: (password: string) => Promise<Result>; submitLabel: string; email?: string }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const pw = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    const problem = passwordProblem(pw) ?? (pw !== confirm ? "Passwords do not match" : null);
    if (problem) { setError(problem); return; }
    setPending(true); setError(null);
    const r = await submit(pw);
    if (!r.ok) { setError(r.message); setPending(false); return; }
    router.push("/login?password=set");
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate data-testid="set-password-form">
      {email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password" className="text-xs font-medium text-ink-2">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required className="h-10" />
        <p className="text-xs text-muted-foreground">At least 10 characters, with a letter and a digit.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm" className="text-xs font-medium text-ink-2">Repeat the password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="h-10" />
      </div>
      {error && <p className="flex items-center gap-1.5 text-xs text-danger" role="alert" data-testid="set-password-error"><AlertCircle className="size-3" />{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{submitLabel}</Button>
    </form>
  );
}
