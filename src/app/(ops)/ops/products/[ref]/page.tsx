import { notFound } from "next/navigation";
import { requireOpsPage, isAdmin, NotFound } from "@/server/shared/authorize";
import { getProduct, clientOrgOptions } from "@/server/ops/products";
import { ProductPage } from "@/components/ops/products/product-page";
import { updateProductAction, publishProductAction, unpublishProductAction, uploadProductImageAction, approveImageAction, removeImageAction } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

/** F-24 — product page: fields, spec versions, images by kind, reference price, publish/unpublish, lines + orders by client. */
export default async function ProductDetailPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const ctx = await requireOpsPage(`/ops/products/${ref}`);
  let p;
  try { p = await getProduct(ctx, ref); } catch (e) { if (e instanceof NotFound) notFound(); throw e; }
  const owners = await clientOrgOptions(ctx);
  return (
    <ProductPage
      p={p}
      isAdmin={isAdmin(ctx)}
      owners={owners}
      actions={{ update: updateProductAction, publish: publishProductAction, unpublish: unpublishProductAction, uploadImage: uploadProductImageAction, approveImage: approveImageAction, removeImage: removeImageAction }}
    />
  );
}
