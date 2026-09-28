import { notFound } from "next/navigation";
import { requireOpsPage, isAdmin, NotFound } from "@/server/shared/authorize";
import { getSupplier } from "@/server/ops/suppliers";
import { SupplierPage } from "@/components/ops/suppliers/supplier-page";
import { updateSupplierAction, addContactAction, updateContactAction, removeContactAction, uploadSupplierDocumentAction, deleteSupplierAction } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

/** F-21 — supplier page: profile, contacts, participations across lines, price lists & catalogues, performance, disclosed_to. */
export default async function SupplierDetailPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const ctx = await requireOpsPage(`/ops/suppliers/${ref}`);
  let s;
  try { s = await getSupplier(ctx, ref); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  return (
    <SupplierPage
      s={s}
      isAdmin={isAdmin(ctx)}
      actions={{ update: updateSupplierAction, addContact: addContactAction, updateContact: updateContactAction, removeContact: removeContactAction, uploadDocument: uploadSupplierDocumentAction, remove: deleteSupplierAction }}
    />
  );
}
