"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, Inbox, FolderOpen, Package, Factory, Boxes, Building2, Send, Search, Menu, LogOut, Settings, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: LucideIcon; count?: number; countTone?: "warning" | "neutral"; active: boolean };
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

/**
 * DESIGN §4.1 — ops sidebar: 232px section-alt rail, white active item with a 3px green left bar, count badges in mono.
 * < 1024px: off-canvas sheet behind a menu button in a slim top bar.
 */
export function OpsShell({ user, counts, children }: { user: { name: string; email: string; role: string }; counts?: { stale?: number; queue?: number; outbox?: number }; children: React.ReactNode }) {
  const t = useTranslations("nav.ops");
  const tr = useTranslations("roles");
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const is = (p: string) => (p === "/ops" ? pathname === "/ops" : pathname.startsWith(p));
  const work: Item[] = [
    { href: "/ops", label: t("dashboard"), icon: LayoutDashboard, active: is("/ops"), count: counts?.stale, countTone: "warning" },
    { href: "/ops/queue", label: t("queue"), icon: Inbox, active: is("/ops/queue"), count: counts?.queue, countTone: "neutral" },
    { href: "/ops/requests", label: t("requests"), icon: FolderOpen, active: is("/ops/requests") || is("/ops/lines") },
    { href: "/ops/orders", label: t("orders"), icon: Package, active: is("/ops/orders") },
  ];
  const master: Item[] = [
    { href: "/ops/suppliers", label: t("suppliers"), icon: Factory, active: is("/ops/suppliers") },
    { href: "/ops/products", label: t("products"), icon: Boxes, active: is("/ops/products") },
    { href: "/ops/clients", label: t("clients"), icon: Building2, active: is("/ops/clients") },
    { href: "/ops/outbox", label: t("outbox"), icon: Send, active: is("/ops/outbox"), count: counts?.outbox, countTone: "warning" },
    { href: "/ops/settings", label: t("settings"), icon: Settings, active: is("/ops/settings") },
  ];
  const nav = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link href="/ops" className="text-base font-bold tracking-[0.04em] text-green-500">INFLUENSIA</Link>
        <span className="inline-flex h-[18px] items-center rounded-md border border-neutral-border bg-card px-1.5 text-[10px] font-semibold tracking-[0.08em] text-neutral">{t("opsChip")}</span>
      </div>
      <div className="px-3 pb-3">
        <button type="button" className="flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm text-faint" aria-label={t("search")}>
          <Search className="size-4" /><span className="flex-1 truncate">{t("search")}</span><kbd className="font-mono text-2xs text-muted-foreground">⌘K</kbd>
        </button>
      </div>
      <nav className="flex-1 space-y-5 px-3" aria-label="Workspace">
        {[{ label: t("work"), items: work }, { label: t("masterData"), items: master }].map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 px-3 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{g.label}</div>
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    aria-current={it.active ? "page" : undefined}
                    className={cn(
                      "relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-[120ms]",
                      it.active ? "bg-sidebar-accent font-semibold text-foreground shadow-sm before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-r before:bg-green-600" : "text-ink-2 hover:bg-white/60 hover:text-foreground",
                    )}
                  >
                    <it.icon className="size-[18px]" strokeWidth={1.75} />
                    <span className="flex-1">{it.label}</span>
                    {typeof it.count === "number" && it.count > 0 && <span className={cn("font-mono text-2xs", it.countTone === "warning" ? "text-warning" : "text-muted-foreground")} data-testid="nav-count">{it.count}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 px-1">
          <Avatar className="size-8"><AvatarFallback className="bg-card text-2xs font-semibold text-ink-2">{initials(user.name)}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{user.name}</div>
            <div className="text-2xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{tr(user.role as "admin")}</div>
          </div>
          <Button asChild variant="ghost" size="icon-sm" aria-label="Sign out"><a href="/logout" data-testid="sign-out"><LogOut /></a></Button>
        </div>
      </div>
    </div>
  );
  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[14.5rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-sidebar-border bg-sidebar lg:block" data-testid="ops-sidebar">{nav}</aside>
      <div className="flex min-w-0 flex-col">
        <div className="flex h-12 items-center gap-2 border-b border-border bg-card px-4 lg:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label={t("menu")}><Menu /></Button></SheetTrigger>
            <SheetContent side="left" className="w-[14.5rem] bg-sidebar p-0"><SheetTitle className="sr-only">{t("menu")}</SheetTitle>{nav}</SheetContent>
          </Sheet>
          <span className="text-base font-bold tracking-[0.04em] text-green-500">INFLUENSIA</span>
        </div>
        <main id="main" className="w-full max-w-[100rem] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
