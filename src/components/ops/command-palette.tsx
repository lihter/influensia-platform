"use client";
/**
 * ⌘K command palette (UX #9, signature #7, QA-21). ⌘K / Ctrl+K / "/" opens it anywhere in ops.
 * Groups: Actions (New request on behalf, + Supplier, Confirm order), Go to (every nav page), Recent (last 8 refs this
 * browser visited), Search (server: REQ/ORD/PRD/SUP/FR refs, line/product/supplier/client names, debounced 150 ms).
 * Typing a full ref ("REQ-2026-0312-02", "ORD-2026-0290") offers a direct "Open" as the first row.
 */
import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import { Search, Plus, CornerDownLeft, Clock, FileText, Package, Factory, Boxes, Building2, Layers, FolderOpen, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { opsSearch, type SearchHit } from "./command-search";

export type PaletteNavItem = { href: string; label: string; icon: LucideIcon };

const RECENT_KEY = "ops.recent.v1";
type Recent = { ref: string; href: string; title?: string };
const readRecent = (): Recent[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Recent[]; } catch { return []; } };

/** Records the current detail page in "Recent" (called by the shell on every navigation). */
export function useTrackRecent() {
  const pathname = usePathname();
  React.useEffect(() => {
    const m = pathname.match(/^\/ops\/(lines|requests|orders|suppliers|products|factory-ranges)\/((?:REQ|ORD|SUP|PRD|FR)-[\w-]+)$/);
    if (!m) return;
    const t = window.setTimeout(() => {
      const title = document.querySelector("h1")?.textContent?.trim().slice(0, 80);
      try {
        const next = [{ ref: m[2], href: pathname, title }, ...readRecent().filter((r) => r.href !== pathname)].slice(0, 8);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch { /* private mode */ }
    }, 600);
    return () => window.clearTimeout(t);
  }, [pathname]);
}

const GROUP_ICON: Record<SearchHit["group"], LucideIcon> = { Lines: FileText, Requests: FolderOpen, Orders: Package, Suppliers: Factory, Products: Boxes, Clients: Building2, "Factory ranges": Layers };
const REF_ROUTE: [RegExp, (r: string) => string][] = [
  [/^REQ-\d{4}-\d{4}-\d{2}$/i, (r) => `/ops/lines/${r.toUpperCase()}`],
  [/^REQ-\d{4}-\d{4}$/i, (r) => `/ops/requests/${r.toUpperCase()}`],
  [/^ORD-\d{4}-\d{4}$/i, (r) => `/ops/orders/${r.toUpperCase()}`],
  [/^PRD-\d{4}$/i, (r) => `/ops/products/${r.toUpperCase()}`],
  [/^SUP-\d{1,4}$/i, (r) => `/ops/suppliers/SUP-${r.split("-")[1].padStart(4, "0")}`],
  [/^FR-\d{4}$/i, (r) => `/ops/factory-ranges/${r.toUpperCase()}`],
];

export function CommandPalette({ open, onOpenChange, nav }: { open: boolean; onOpenChange: (o: boolean) => void; nav: PaletteNavItem[] }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [result, setResult] = React.useState<{ q: string; hits: SearchHit[] }>({ q: "", hits: [] });
  // localStorage is read only while open (client-only: the dialog is closed during SSR)
  const recent = React.useMemo(() => (open ? readRecent() : []), [open]);
  const query = q.trim();
  React.useEffect(() => {
    if (query.length < 2) return;
    let live = true;
    const t = window.setTimeout(() => {
      opsSearch(query).then((h) => { if (live) setResult({ q: query, hits: h }); }).catch(() => { if (live) setResult({ q: query, hits: [] }); });
    }, 150);
    return () => { live = false; window.clearTimeout(t); };
  }, [query]);
  const hits = query.length >= 2 ? result.hits : [];
  const loading = query.length >= 2 && result.q !== query;
  const change = (o: boolean) => { if (!o) setQ(""); onOpenChange(o); };

  const go = (href: string) => { change(false); router.push(href); };
  const needle = q.trim().toLowerCase();
  const match = (s: string) => !needle || s.toLowerCase().includes(needle);
  const actions = [
    { label: "New request on behalf of a client", href: "/ops/requests/new", icon: Plus, keywords: "create add request" },
    { label: "Add supplier", href: "/ops/suppliers?new=1", icon: Plus, keywords: "+ supplier create factory" },
    { label: "Confirm order from an accepted offer", href: "/ops/orders/new", icon: Plus, keywords: "create order" },
  ].filter((a) => match(a.label + " " + a.keywords));
  const pages = nav.filter((n) => match(n.label));
  const direct = REF_ROUTE.find(([re]) => re.test(q.trim()));
  const groups = Object.entries(hits.reduce<Record<string, SearchHit[]>>((acc, h) => { (acc[h.group] ??= []).push(h); return acc; }, {}));
  const recentShown = needle ? recent.filter((r) => match(`${r.ref} ${r.title ?? ""}`)) : recent;

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent showCloseButton={false} className="top-[12vh] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[40rem]" data-testid="command-palette">
        <DialogTitle className="sr-only">Search or jump to</DialogTitle>
        <DialogDescription className="sr-only">Type a reference like REQ-2026-0312-02, a product, supplier or client name, or a page.</DialogDescription>
        <CommandPrimitive shouldFilter={false} loop className="flex flex-col">
          <div className="flex h-12 items-center gap-2 border-b border-border px-4">
            <Search className="size-4 text-muted-foreground" />
            <CommandPrimitive.Input value={q} onValueChange={setQ} autoFocus placeholder="Jump to REQ / ORD / SUP / PRD, a name, or a page…" className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-faint" data-testid="command-input" />
            {loading && <span className="text-2xs text-muted-foreground">Searching…</span>}
            <kbd className="rounded border border-border px-1.5 font-mono text-2xs text-muted-foreground">Esc</kbd>
          </div>
          <CommandPrimitive.List className="max-h-[60vh] overflow-y-auto p-2">
            <CommandPrimitive.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">{loading ? "Searching…" : `Nothing matches “${q}”.`}</CommandPrimitive.Empty>
            {direct && (
              <Group heading="Open">
                <Row value={`direct-${q}`} onSelect={() => go(direct[1](q.trim()))} icon={CornerDownLeft} title={<span className="font-mono">{q.trim().toUpperCase()}</span>} hint="Open" />
              </Group>
            )}
            {groups.map(([g, list]) => (
              <Group key={g} heading={g}>
                {list.map((h) => <Row key={h.group + h.href} value={h.href} onSelect={() => go(h.href)} icon={GROUP_ICON[h.group]} refText={h.ref} title={h.title} sub={h.sub} />)}
              </Group>
            ))}
            {actions.length > 0 && (
              <Group heading="Actions">
                {actions.map((a) => <Row key={a.href} value={`action-${a.href}`} onSelect={() => go(a.href)} icon={a.icon} title={a.label} />)}
              </Group>
            )}
            {recentShown.length > 0 && (
              <Group heading="Recent">
                {recentShown.map((r) => <Row key={r.href} value={`recent-${r.href}`} onSelect={() => go(r.href)} icon={Clock} refText={r.ref} title={r.title && r.title !== r.ref ? r.title : ""} />)}
              </Group>
            )}
            {pages.length > 0 && (
              <Group heading="Go to">
                {pages.map((n) => <Row key={n.href} value={`page-${n.href}`} onSelect={() => go(n.href)} icon={n.icon} title={n.label} />)}
              </Group>
            )}
          </CommandPrimitive.List>
          <div className="flex items-center gap-4 border-t border-border bg-section-alt px-4 py-2 text-2xs text-muted-foreground">
            <span><kbd className="font-mono">↑↓</kbd> move</span><span><kbd className="font-mono">↵</kbd> open</span><span><kbd className="font-mono">⌘K</kbd> or <kbd className="font-mono">/</kbd> anywhere</span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <CommandPrimitive.Group heading={heading} className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase">
      {children}
    </CommandPrimitive.Group>
  );
}

function Row({ value, onSelect, icon: Icon, refText, title, sub, hint }: { value: string; onSelect: () => void; icon: LucideIcon; refText?: string; title: React.ReactNode; sub?: string; hint?: string }) {
  return (
    <CommandPrimitive.Item value={value} onSelect={onSelect} className={cn("flex h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground")}>
      <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      {refText && <span className="shrink-0 font-mono text-xs text-ink-2">{refText}</span>}
      <span className="min-w-0 flex-1 truncate">{title}{sub && <span className="ml-2 text-xs text-muted-foreground">{sub}</span>}</span>
      {hint && <span className="text-2xs text-muted-foreground">{hint}</span>}
    </CommandPrimitive.Item>
  );
}
