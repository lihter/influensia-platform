import Link from "next/link";

/** Root 404 (also what a client sees for /ops/*: the ops layout calls notFound() before rendering its shell). */
export default function RootNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-ink-2">This page does not exist.</p>
      <Link href="/" className="link text-sm">Back to the app</Link>
    </main>
  );
}
