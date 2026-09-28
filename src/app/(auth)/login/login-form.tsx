"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** F-01: email + password, generic error (no enumeration), role redirect via `/` (or same-door `?next=`). */
export function LoginForm({ next }: { next: string | null }) {
  const t = useTranslations("auth.login");
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({ email: String(fd.get("email")).trim(), password: String(fd.get("password")) });
    if (error) { setError(error.status === 429 ? t("rateLimited", { minutes: 15 }) : t("invalid")); setPending(false); return; }
    // `/` redirects by role; a same-door `next` is honoured there via the login page guard.
    router.push(next ? `/login?next=${encodeURIComponent(next)}` : "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" data-testid="login-form" noValidate>
      <div>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-ink-2">{t("subtitle")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email" className="text-xs font-medium text-ink-2">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password" className="text-xs font-medium text-ink-2">{t("password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-10" />
      </div>
      {error && <p className="flex items-center gap-1.5 text-xs text-danger" role="alert" data-testid="login-error"><AlertCircle className="size-3" />{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{pending ? t("submitting") : t("submit")}</Button>
      <Link href="/forgot-password" className="link text-center text-sm">{t("forgot")}</Link>
    </form>
  );
}
