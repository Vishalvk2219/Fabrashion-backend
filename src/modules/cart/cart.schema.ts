import { z } from 'zod';

const MAX_QTY = 99;

/** POST /cart/items — add `quantity` of a variant (increments an existing line). */
export const addItemSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(MAX_QTY).default(1),
});
export type AddItemInput = z.infer<typeof addItemSchema>;

/** PATCH /cart/items/:itemId — set an absolute quantity; 0 removes the line. */
export const updateItemSchema = z.object({
  quantity: z.coerce.number().int().min(0).max(MAX_QTY),
});
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const itemParamsSchema = z.object({ itemId: z.string().uuid() });
export type ItemParams = z.infer<typeof itemParamsSchema>;
