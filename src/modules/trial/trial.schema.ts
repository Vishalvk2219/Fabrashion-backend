import { z } from 'zod';

const uuid = z.string().uuid();

/** GET /trials/eligibility?variantIds=a,b,c&addressId= */
export const eligibilityQuerySchema = z.object({
  variantIds: z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(uuid).min(1).max(10)),
  addressId: uuid,
});
export type EligibilityQuery = z.infer<typeof eligibilityQuerySchema>;

/** POST /trials — book an at-home trial (holds stock; charge captured via confirm-dev / 4c). */
export const createTrialSchema = z.object({
  items: z
    .array(z.object({ variantId: uuid, qty: z.number().int().min(1).max(3) }))
    .min(1)
    .max(10)
    .refine((items) => new Set(items.map((i) => i.variantId)).size === items.length, {
      message: 'Duplicate variant in items',
    }),
  addressId: uuid,
  slotStart: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
});
export type CreateTrialInput = z.infer<typeof createTrialSchema>;

export const trialParamsSchema = z.object({ id: uuid });
export type TrialParams = z.infer<typeof trialParamsSchema>;

/** POST /trials/:id/outcome — every item must be resolved KEPT or RETURNED. */
export const outcomeSchema = z.object({
  items: z
    .array(z.object({ trialItemId: uuid, outcome: z.enum(['KEPT', 'RETURNED']) }))
    .min(1)
    .max(10)
    .refine((items) => new Set(items.map((i) => i.trialItemId)).size === items.length, {
      message: 'Duplicate trial item in outcomes',
    }),
});
export type OutcomeInput = z.infer<typeof outcomeSchema>;

export const trialListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type TrialListQuery = z.infer<typeof trialListQuerySchema>;
