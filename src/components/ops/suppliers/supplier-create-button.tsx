"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SupplierForm } from "./supplier-form";

/** "+ Supplier" header action; `defaultOpen` when reached from the ⌘K palette (`/ops/suppliers?new=1`). */
export function SupplierCreateButton({ isAdmin, onCreate, defaultOpen }: { isAdmin: boolean; onCreate: React.ComponentProps<typeof SupplierForm>["onCreate"]; defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <SupplierForm
      mode="create" isAdmin={isAdmin} onCreate={onCreate} open={open}
      onOpenChange={(o) => { setOpen(o); if (!o && defaultOpen) router.replace("/ops/suppliers"); }}
      trigger={<Button data-testid="new-supplier"><Plus data-icon="inline-start" />Supplier</Button>}
    />
  );
}
