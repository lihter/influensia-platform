import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotPasswordAction } from "./actions";

export const metadata = { title: "Reset password" };

/** F-01 stub: always shows the same success message (AC-AUTH-06). Token flow is a known gap (FOUNDATION.md). */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const t = await getTranslations("auth.forgot");
  const { sent } = await searchParams;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-ink-2">{t("subtitle")}</p>
      </div>
      {sent ? (
        <p className="rounded-lg border border-success-border bg-success-wash px-3 py-2 text-sm text-success" data-testid="forgot-done">{t("done")}</p>
      ) : (
        <form action={forgotPasswordAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-xs font-medium text-ink-2">{t("email")}</Label>
            <Input id="email" name="email" type="email" required className="h-10" />
          </div>
          <Button type="submit" size="lg" className="w-full">{t("submit")}</Button>
        </form>
      )}
      <Link href="/login" className="link text-center text-sm">{t("back")}</Link>
    </div>
  );
}
