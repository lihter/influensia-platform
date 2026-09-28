import { z } from "zod";
import { UnitPriceDto, isoDate } from "./common";
import { ClientPreviousOrderDto } from "./order";

/** Only `product_images.kind = clean` rows are ever mapped here. */
export const ClientProductImageDto = z.object({ id: z.uuid(), url: z.string() }).strict();

/** Catalog card (D-16). Reference price is always all-in. `owner_org_id` never appears. */
export const ClientCatalogDto = z.object({
  id: z.uuid(),
  ref: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  unit: z.string(),
  image: ClientProductImageDto.nullable(),
  referencePrice: UnitPriceDto.nullable(),
  referenceMoq: z.number().int().nullable(),
  referenceIncoterm: z.string().nullable(),
  referencePort: z.string().nullable(),
  referenceSpecVersion: z.number().int().nullable(),
  referenceValidUntil: isoDate.nullable(),
  /** reference_valid_until < today → "price to be confirmed" */
  priceStale: z.boolean(),
  orderedBefore: z.boolean(),
}).strict();
export type ClientCatalogDto = z.infer<typeof ClientCatalogDto>;

export const ClientSpecFieldDto = z.object({ key: z.string(), value: z.string() }).strict();

export const ClientCatalogProductDto = ClientCatalogDto.extend({
  description: z.string().nullable(),
  images: z.array(ClientProductImageDto),
  spec: z.array(ClientSpecFieldDto),
  previousOrders: z.array(ClientPreviousOrderDto),
}).strict();
export type ClientCatalogProductDto = z.infer<typeof ClientCatalogProductDto>;
