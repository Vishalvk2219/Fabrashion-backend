import { z } from 'zod';

/** POST /checkout — place the active cart as a PENDING order shipped to a saved address. */
export const checkoutSchema = z.object({ addressId: z.string().uuid() });
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const orderParamsSchema = z.object({ id: z.string().uuid() });
export type OrderParams = z.infer<typeof orderParamsSchema>;

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
