import { z } from "zod";
import { UnitPriceDto, isoDateTime } from "./common";
import { ClientProductImageDto } from "./product";
import { ClientFactoryRangeItemDto } from "./factory-range";

/**
 * D-15 / SPEC 5.2 `factory_ranges`: the client learns the label, the sanitised items and the published PDF — nothing else.
 * The range is addressed by its uuid on `/app/ranges/[id]` (the internal `FR-` ref never leaves the server).
 */
export const ClientRangePdfDto = z.object({
  filename: z.string(),
  bytes: z.number().int().nonnegative(),
  /** always /api/files/{client key} */
  downloadUrl: z.string(),
}).strict();
export type ClientRangePdfDto = z.infer<typeof ClientRangePdfDto>;

/** Catalog page section header: one per published range of the org. */
export const ClientRangeSummaryDto = z.object({
  id: z.uuid(),
  factoryLabel: z.string(),                // "F-0042"
  href: z.string(),                        // /app/ranges/{id}
  itemCount: z.number().int().nonnegative(),
  /** names of your products this factory is making / has made (order refs, not supplier facts) */
  yourProducts: z.array(z.string()),
  orderRefs: z.array(z.string()),
  publishedAt: isoDateTime,
  image: ClientProductImageDto.nullable(),
  preview: z.array(z.object({ name: z.string(), price: UnitPriceDto.nullable() }).strict()),
}).strict();
export type ClientRangeSummaryDto = z.infer<typeof ClientRangeSummaryDto>;

export const ClientRangeDto = z.object({
  id: z.uuid(),
  factoryLabel: z.string(),
  yourProducts: z.array(z.string()),
  orderRefs: z.array(z.string()),
  publishedAt: isoDateTime,
  pdf: ClientRangePdfDto.nullable(),
  items: z.array(ClientFactoryRangeItemDto.extend({ moqLabel: z.string().nullable(), unit: z.string() }).strict()),
}).strict();
export type ClientRangeDto = z.infer<typeof ClientRangeDto>;

/** Result of "Request these items". */
export const ClientRangeRequestDto = z.object({
  requestRef: z.string(),
  lineRefs: z.array(z.string()),
  factoryLabel: z.string(),
}).strict();
export type ClientRangeRequestDto = z.infer<typeof ClientRangeRequestDto>;
