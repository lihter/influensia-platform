"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, Boxes, Package, FolderOpen, Sparkles, BookOpen, Plus, Menu, LogOut, Settings, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { clientInitials } from "./client-format";

type Item = { href: string; label: string; icon: LucideIcon; active: boolean; testId: string };

/**
 * Client sidebar — the same rail as ops (232px section-alt, white active item with the 3px green bar) so both sides of the
 * platform read alike. Groups: the client's own business (Overview · Products · Orders · Requests) and what we offer
 * (Suggestions · Catalogues). < 1024px: off-canvas sheet behind a slim top bar with a "+" for a new request.
 */
export function AppShell({ user, companyLabel, children }: { user: { name: string; email: string }; companyLabel?: string; children: React.ReactNode }) {
  const t = useTranslations("nav.app");
  const ta = useTranslations("auth");
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const is = (...ps: string[]) => ps.some((p) => (p === "/app" ? pathname === "/app" : pathname === p || pathname.startsWith(`${p}/`)));
  const yours: Item[] = [
    { href: "/app", label: t("dashboard"), icon: LayoutDashboard, active: is("/app"), testId: "nav-overview" },
    { href: "/app/products", label: t("products"), icon: Boxes, active: is("/app/products"), testId: "nav-products" },
    { href: "/app/orders", label: t("orders"), icon: Package, active: is("/app/orders"), testId: "nav-orders" },
    { href: "/app/requests", label: t("requests"), icon: FolderOpen, active: is("/app/requests", "/app/lines", "/app/offers", "/app/samples"), testId: "nav-requests" },
  ];
  const ours: Item[] = [
    { href: "/app/catalog", label: t("catalog"), icon: Sparkles, active: is("/app/catalog"), testId: "nav-suggestions" },
    { href: "/app/catalogues", label: t("catalogues"), icon: BookOpen, active: is("/app/catalogues", "/app/ranges"), testId: "nav-catalogues" },
  ];
  const nav = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link href="/app" onClick={() => setOpen(false)} className="text-base font-bold tracking-[0.04em] text-green-500" aria-label="Influensia">INFLUENSIA</Link>
      </div>
      <div className="px-3 pb-4">
        <Button asChild className="w-full justify-center" data-testid="nav-new-request"><Link href="/app/requests/new" onClick={() => setOpen(false)}><Plus data-icon="inline-start" />{t("newRequest")}</Link></Button>
      </div>
      <nav className="flex-1 space-y-5 px-3" aria-label="Main">
        {[{ label: companyLabel || t("yours"), items: yours }, { label: t("fromUs"), items: ours }].map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 truncate px-3 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{g.label}</div>
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    aria-current={it.active ? "page" : undefined}
                    data-testid={it.testId}
                    className={cn(
                      "relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-[120ms]",
                      it.active ? "bg-sidebar-accent font-semibold text-foreground shadow-sm before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-r before:bg-green-600" : "text-ink-2 hover:bg-white/60 hover:text-foreground",
                    )}
                  >
                    <it.icon className="size-[18px]" strokeWidth={1.75} />
                    <span className="flex-1">{it.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 px-1">
          <Avatar className="size-8"><AvatarFallback className="bg-card text-2xs font-semibold text-ink-2">{clientInitials(user.name)}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{user.name}</div>
            <div className="truncate text-2xs text-muted-foreground">{user.email}</div>
          </div>
          <Button asChild variant="ghost" size="icon-sm" aria-label={t("settings")}><Link href="/app/settings" onClick={() => setOpen(false)} data-testid="nav-settings"><Settings /></Link></Button>
          <Button asChild variant="ghost" size="icon-sm" aria-label={ta("logout")}><a href="/logout" data-testid="sign-out"><LogOut /></a></Button>
        </div>
      </div>
    </div>
  );
  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[14.5rem_1fr] lg:bg-[linear-gradient(to_right,var(--sidebar)_calc(14.5rem-1px),var(--sidebar-border)_calc(14.5rem-1px),var(--sidebar-border)_14.5rem,transparent_14.5rem)]">
      <aside className="sticky top-0 hidden h-dvh border-r border-sidebar-border bg-sidebar lg:block" data-testid="client-sidebar">{nav}</aside>
      <div className="flex min-w-0 flex-col overflow-x-clip">
        <div className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b border-border bg-card px-4 lg:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label={t("menu")} data-testid="nav-menu"><Menu /></Button></SheetTrigger>
            <SheetContent side="left" className="w-[14.5rem] bg-sidebar p-0"><SheetTitle className="sr-only">{t("menu")}</SheetTitle>{nav}</SheetContent>
          </Sheet>
          <Link href="/app" className="text-base font-bold tracking-[0.04em] text-green-500">INFLUENSIA</Link>
          <Button asChild size="icon-sm" className="ml-auto" aria-label={t("newRequest")}><Link href="/app/requests/new"><Plus /></Link></Button>
        </div>
        {/* Pages own their vertical rhythm with full-bleed bands (shared/section-band.tsx); main only sets the gutter. */}
        <main id="main" className="w-full max-w-[90rem] flex-1 px-4 pb-16 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
