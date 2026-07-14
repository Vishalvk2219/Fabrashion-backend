import { z } from 'zod';

/** Sort options for the product list (mirrors the app's listing chips). */
export const PRODUCT_SORTS = ['popular', 'newest', 'price_asc', 'price_desc'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Query params for `GET /products`. All optional; coerced from strings. Prices are paise. */
export const productListQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    categoryId: z.string().uuid().optional(),
    minPrice: z.coerce.number().int().nonnegative().optional(),
    maxPrice: z.coerce.number().int().nonnegative().optional(),
    sort: z.enum(PRODUCT_SORTS).default('popular'),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(20),
  })
  .refine((v) => v.minPrice == null || v.maxPrice == null || v.maxPrice >= v.minPrice, {
    message: 'maxPrice must be greater than or equal to minPrice',
    path: ['maxPrice'],
  });
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

/** Route params for product detail / availability — accepts a UUID id or a slug. */
export const productParamsSchema = z.object({ id: z.string().min(1).max(200) });
export type ProductParams = z.infer<typeof productParamsSchema>;
