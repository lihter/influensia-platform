"use client";
import { useEffect } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function ClientError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <EmptyState title="Something went wrong" body={`Reference ${error.digest ?? "n/a"}`} action={<Button variant="outline" onClick={reset}>Try again</Button>} />;
}
