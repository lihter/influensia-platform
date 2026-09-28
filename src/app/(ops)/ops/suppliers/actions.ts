"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, OPS_ROLES } from "@/server/shared/authorize";
import { toActionError, type ActionResult } from "@/server/shared/http";
import {
  createSupplier, updateSupplier, addContact, updateContact, removeContact, uploadSupplierDocument, deleteSupplier, DuplicateSupplier,
  SUPPLIER_TYPE_VERDICTS, VERDICT_SOURCES, SUPPLIER_GRADES, CONTACT_CHANNELS, SUPPLIER_PORTS,
} from "@/server/ops/suppliers";

const opt = z.string().trim().max(500).optional().nullable();
const SupplierSchema = z.object({
  legalName: z.string().trim().min(2, "Legal name is required").max(200),
  cnName: opt,
  typeVerdict: z.enum(SUPPLIER_TYPE_VERDICTS).default("unchecked"),
  verdictSource: z.enum(VERDICT_SOURCES).nullable().optional(),
  grade: z.enum(SUPPLIER_GRADES).nullable().optional(),
  uscc: z.string().trim().regex(/^[0-9A-Z]{18}$/, "USCC is 18 alphanumeric characters").optional().nullable().or(z.literal("")),
  registeredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().nullable().or(z.literal("")),
  capital: opt,
  city: opt,
  province: opt,
  country: z.string().trim().max(2).optional().nullable().or(z.literal("")),
  ports: z.array(z.enum(SUPPLIER_PORTS)).default([]),
  website: opt,
  notes: z.string().trim().max(4000).optional().nullable(),
});
const ContactSchema = z.object({
  name: z.string().trim().max(200).optional().nullable(),
  channel: z.enum(CONTACT_CHANNELS),
  handle: z.string().trim().max(300).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  isPrimary: z.boolean().optional(),
}).refine((c) => (c.name && c.name.length > 0) || (c.handle && c.handle.length > 0), { message: "Name or handle is required", path: ["name"] });

export type SupplierFormInput = z.input<typeof SupplierSchema>;
export type ContactFormInput = z.input<typeof ContactSchema>;

const norm = <T extends { uscc?: string | null; registeredAt?: string | null; country?: string | null }>(v: T) => ({ ...v, uscc: v.uscc || null, registeredAt: v.registeredAt || null, country: v.country || null });

function dupError(e: unknown): ActionResult<never> | null {
  if (e instanceof DuplicateSupplier) return { ok: false, error: e.code, errors: { legalName: `Looks like ${e.existing.ref} ${e.existing.legalName}` } };
  return null;
}

export async function createSupplierAction(raw: SupplierFormInput & { contact?: ContactFormInput | null; createAnyway?: boolean }): Promise<ActionResult<{ id: string; ref: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const input = SupplierSchema.parse(raw);
    const contact = raw.contact && (raw.contact.name || raw.contact.handle) ? ContactSchema.parse(raw.contact) : null;
    const r = await createSupplier(ctx, { ...norm(input), contact, createAnyway: !!raw.createAnyway });
    revalidatePath("/ops/suppliers");
    return { ok: true, data: r };
  } catch (e) {
    return dupError(e) ?? toActionError(e);
  }
}

export async function updateSupplierAction(raw: { id: string } & SupplierFormInput): Promise<ActionResult<{ ref: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { id } = z.object({ id: z.uuid() }).parse(raw);
    const input = SupplierSchema.parse(raw);
    const r = await updateSupplier(ctx, id, norm(input));
    revalidatePath("/ops/suppliers");
    revalidatePath(`/ops/suppliers/${r.ref}`);
    return { ok: true, data: r };
  } catch (e) {
    return dupError(e) ?? toActionError(e);
  }
}

export async function addContactAction(raw: { supplierId: string; supplierRef: string } & ContactFormInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { supplierId, supplierRef } = z.object({ supplierId: z.uuid(), supplierRef: z.string() }).parse(raw);
    const r = await addContact(ctx, supplierId, ContactSchema.parse(raw));
    revalidatePath(`/ops/suppliers/${supplierRef}`);
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateContactAction(raw: { contactId: string; supplierRef: string } & ContactFormInput): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { contactId, supplierRef } = z.object({ contactId: z.uuid(), supplierRef: z.string() }).parse(raw);
    await updateContact(ctx, contactId, ContactSchema.parse(raw));
    revalidatePath(`/ops/suppliers/${supplierRef}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeContactAction(raw: { contactId: string; supplierRef: string }): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const { contactId, supplierRef } = z.object({ contactId: z.uuid(), supplierRef: z.string() }).parse(raw);
    await removeContact(ctx, contactId);
    revalidatePath(`/ops/suppliers/${supplierRef}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

const DOC_MIME = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|text\/csv|application\/zip|image\/(jpeg|png|webp))$/;

/** Price list / catalogue upload (internal document on the supplier). FormData: file, kind, validUntil?, currency?, notes?, supplierId, supplierRef. */
export async function uploadSupplierDocumentAction(fd: FormData): Promise<ActionResult<{ documentId: string }>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const meta = z.object({
      supplierId: z.uuid(), supplierRef: z.string(), kind: z.enum(["price_list", "catalogue"]),
      validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")), currency: z.string().trim().max(3).optional(), notes: z.string().trim().max(1000).optional(),
    }).parse({ supplierId: fd.get("supplierId"), supplierRef: fd.get("supplierRef"), kind: fd.get("kind"), validUntil: fd.get("validUntil") ?? "", currency: fd.get("currency") ?? "USD", notes: fd.get("notes") ?? "" });
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "E_VALIDATION", errors: { file: "Choose a file" } };
    if (file.size > 25 * 1024 * 1024) return { ok: false, error: "E_VALIDATION", errors: { file: "Max 25 MB" } };
    const mime = file.type || "application/octet-stream";
    if (!DOC_MIME.test(mime) && !/\.(pdf|xlsx|xls|csv|zip|jpe?g|png|webp)$/i.test(file.name)) return { ok: false, error: "E_VALIDATION", errors: { file: "pdf, xlsx, xls, csv, zip or image" } };
    const r = await uploadSupplierDocument(ctx, { supplierId: meta.supplierId, kind: meta.kind, data: Buffer.from(await file.arrayBuffer()), mime, filename: file.name, validUntil: meta.validUntil || null, currency: meta.currency || "USD", notes: meta.notes || null });
    revalidatePath(`/ops/suppliers/${meta.supplierRef}`);
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteSupplierAction(raw: { id: string }): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const { id } = z.object({ id: z.uuid() }).parse(raw);
    await deleteSupplier(ctx, id);
    revalidatePath("/ops/suppliers");
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}
