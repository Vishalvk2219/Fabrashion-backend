import { z } from 'zod';

/** Fulfilment stages as the staff shell shows them (Try-at-Home fills in Phase 6). */
export const STAFF_STAGES = ['TO_PACK', 'TRY_AT_HOME', 'READY', 'HANDED_OVER'] as const;
export type StaffStage = (typeof STAFF_STAGES)[number];

export const staffInventoryQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type StaffInventoryQuery = z.infer<typeof staffInventoryQuerySchema>;

const delta = z.coerce.number().int().min(-99).max(99);

/**
 * PATCH /staff/inventory/:variantId — bucket deltas, idempotent by `eventId`.
 * Deltas (not absolute values) so the mobile offline queue can replay safely in
 * any connectivity order; negativity is guarded atomically server-side.
 */
export const adjustInventorySchema = z.object({
  deltas: z
    .object({
      floor: delta.optional(),
      counter: delta.optional(),
      reserved: delta.optional(),
    })
    .refine((d) => Object.values(d).some((v) => v !== undefined && v !== 0), {
      message: 'At least one non-zero delta is required',
    }),
  eventId: z.string().uuid(),
});
export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;

export const variantParamsSchema = z.object({ variantId: z.string().uuid() });
export type VariantParams = z.infer<typeof variantParamsSchema>;

export const staffOrdersQuerySchema = z.object({
  stage: z.enum(STAFF_STAGES).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type StaffOrdersQuery = z.infer<typeof staffOrdersQuerySchema>;

export const orderParamsSchema = z.object({ id: z.string().uuid() });
export type OrderParams = z.infer<typeof orderParamsSchema>;

export const staffTrialsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type StaffTrialsQuery = z.infer<typeof staffTrialsQuerySchema>;
