import { notFound } from "next/navigation";
import { requireOpsPage, isAdmin, NotFound } from "@/server/shared/authorize";
import { getRange, productOptions } from "@/server/ops/ranges";
import { RangePage } from "@/components/ops/products/range-page";
import { uploadRangePdfAction, addRangeItemAction, updateRangeItemAction, removeRangeItemAction, uploadRangeItemImageAction, checkRangeAction, publishRangeAction, unpublishRangeAction, setRangeDisplayNameAction } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

/** F-25 — range page: PDF, items, leak-check result, Publish (admin) / Unpublish, "Shown to: {client}". */
export default async function RangeDetailPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const ctx = await requireOpsPage(`/ops/factory-ranges/${ref}`);
  let r;
  try { r = await getRange(ctx, ref); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  const products = await productOptions(ctx);
  return (
    <RangePage
      r={r}
      isAdmin={isAdmin(ctx)}
      products={products}
      actions={{ uploadPdf: uploadRangePdfAction, addItem: addRangeItemAction, updateItem: updateRangeItemAction, removeItem: removeRangeItemAction, uploadItemImage: uploadRangeItemImageAction, check: checkRangeAction, publish: publishRangeAction, unpublish: unpublishRangeAction, rename: setRangeDisplayNameAction }}
    />
  );
}
