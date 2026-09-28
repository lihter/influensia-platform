"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/server/shared/http";

const MESSAGES: Record<string, string> = {
  E_ILLEGAL_TRANSITION: "That step is not allowed from the current state.",
  E_LEAK_CHECK: "Blocked: the text names a supplier.",
  E_VALIDATION: "Please check the highlighted fields.",
  E_NOT_FOUND: "Not found.",
  E_FORBIDDEN: "You are not allowed to do that.",
  E_UNAUTHORIZED: "Please sign in again.",
  E_INTERNAL: "Something went wrong.",
};

export function errorMessage(r: { error: string; errors?: Record<string, string>; hits?: { kind: string; match: string; where: string }[] }): string {
  if (r.error === "E_LEAK_CHECK" && r.hits?.length) return `Leak check: ${r.hits.map((h) => `${h.kind.replace(/_/g, " ")} '${h.match}' in ${h.where}`).join("; ")}`;
  if (r.error === "E_VALIDATION" && r.errors) return Object.values(r.errors).join(" · ");
  return MESSAGES[r.error] ?? r.error;
}

/** Runs a server action with a pending flag, toasts the outcome, refreshes the route on success. */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const run = React.useCallback(async <T,>(fn: () => Promise<ActionResult<T>>, opts?: { success?: string | ((d: T) => string); silent?: boolean; noRefresh?: boolean }): Promise<T | null> => {
    setPending(true); setErrors({});
    try {
      const r = await fn();
      if (r.ok) {
        if (!opts?.silent) toast.success(typeof opts?.success === "function" ? opts.success(r.data) : opts?.success ?? "Saved");
        if (!opts?.noRefresh) router.refresh();
        return r.data;
      }
      setErrors(r.errors ?? (r.error === "E_LEAK_CHECK" ? { _: errorMessage(r) } : {}));
      toast.error(errorMessage(r), { duration: r.error === "E_LEAK_CHECK" ? 10000 : 6000 });
      return null;
    } finally { setPending(false); }
  }, [router]);
  return { run, pending, errors, setErrors };
}
