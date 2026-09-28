import { z } from "zod";

/** Result of "Request offer" (F-11): the request just created, nothing else. */
export const ClientCatalogRequestDto = z.object({
  requestRef: z.string(),
  lineRef: z.string(),
  productRef: z.string(),
  name: z.string(),
  qty: z.number().int().positive(),
  unit: z.string(),
}).strict();
export type ClientCatalogRequestDto = z.infer<typeof ClientCatalogRequestDto>;

/** Category chips on the catalog page: label + count of published products. */
export const ClientCatalogCategoryDto = z.object({ category: z.string(), count: z.number().int().nonnegative() }).strict();
export type ClientCatalogCategoryDto = z.infer<typeof ClientCatalogCategoryDto>;
