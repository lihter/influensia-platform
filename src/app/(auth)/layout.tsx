export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-8 text-2xl font-bold tracking-[0.04em] text-green-500" aria-label="Influensia">INFLUENSIA</div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 sm:p-8">{children}</div>
    </main>
  );
}
