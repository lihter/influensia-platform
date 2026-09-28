"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Menu, Plus, LogOut, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { clientInitials } from "./client-format";

/**
 * DESIGN §4.1 — client top bar: wordmark, three links with a green underline active state, black "New request", avatar menu.
 * < 768px: links move into a left sheet, New request becomes an icon button. Works at 390px with 16px gutters.
 */
export function AppShell({ user, children }: { user: { name: string; email: string }; children: React.ReactNode }) {
  const t = useTranslations("nav.app");
  const ta = useTranslations("auth");
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const links = [
    { href: "/app", label: t("dashboard"), active: pathname === "/app" },
    { href: "/app/requests", label: t("requests"), active: pathname.startsWith("/app/requests") || pathname.startsWith("/app/lines") || pathname.startsWith("/app/orders") || pathname.startsWith("/app/offers") || pathname.startsWith("/app/samples") },
    { href: "/app/catalog", label: t("catalog"), active: pathname.startsWith("/app/catalog") || pathname.startsWith("/app/ranges") },
  ];
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 h-14 border-b border-border bg-card">
        <div className="mx-auto flex h-full max-w-[72rem] items-center gap-6 px-4 sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("menu")}><Menu /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">{t("menu")}</SheetTitle>
              <div className="flex h-14 items-center border-b border-border px-5 font-bold tracking-[0.04em] text-green-500">INFLUENSIA</div>
              <nav className="flex flex-col p-3" aria-label="Main">
                {links.map((l) => (
                  <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={cn("rounded-lg px-3 py-2.5 text-base font-medium", l.active ? "bg-green-50 text-foreground" : "text-ink-2 hover:bg-surface-sunken")} aria-current={l.active ? "page" : undefined}>
                    {l.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
          <Link href="/app" className="shrink-0 text-lg font-bold tracking-[0.04em] text-green-500" aria-label="Influensia">INFLUENSIA</Link>
          <nav className="hidden h-full items-center gap-6 md:flex" aria-label="Main">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.active ? "page" : undefined} className={cn("relative flex h-full items-center text-sm font-medium transition-colors", l.active ? "font-semibold text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-green-600" : "text-ink-2 hover:text-foreground")}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild size="sm" className="hidden md:inline-flex"><Link href="/app/requests/new"><Plus data-icon="inline-start" />{t("newRequest")}</Link></Button>
            <Button asChild size="icon-sm" className="md:hidden" aria-label={t("newRequest")}><Link href="/app/requests/new"><Plus /></Link></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={t("account")}>
                  <Avatar className="size-8"><AvatarFallback className="bg-section-alt text-2xs font-semibold text-ink-2">{clientInitials(user.name)}</AvatarFallback></Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium text-foreground">{user.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link href="/app/settings"><Settings />{t("settings")}</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><a href="/logout" data-testid="sign-out"><LogOut />{ta("logout")}</a></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-[72rem] px-4 pb-16 sm:px-6">{children}</main>
    </div>
  );
}
