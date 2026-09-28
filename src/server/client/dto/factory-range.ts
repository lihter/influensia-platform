import { z } from "zod";
import { UnitPriceDto } from "./common";
import { ClientProductImageDto } from "./product";
import { ClientDocumentDto } from "./document";

export const ClientFactoryRangeItemDto = z.object({
  id: z.uuid(),
  name: z.string(),
  image: ClientProductImageDto.nullable(),
  moq: z.number().int().nullable(),
  price: UnitPriceDto.nullable(),
  madeHere: z.boolean().nullable(),
  note: z.string().nullable(),
}).strict();
export type ClientFactoryRangeItemDto = z.infer<typeof ClientFactoryRangeItemDto>;

/** D-15: label + items + the sanitised PDF. No supplier attribute of any kind. */
export const ClientFactoryRangeDto = z.object({
  id: z.uuid(),
  factoryLabel: z.string(),            // "F-0042"
  productName: z.string(),             // "the factory making your {product}"
  orderRef: z.string(),
  pdf: ClientDocumentDto.nullable(),
  items: z.array(ClientFactoryRangeItemDto),
}).strict();
export type ClientFactoryRangeDto = z.infer<typeof ClientFactoryRangeDto>;
