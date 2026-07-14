import { z } from '@/lib/zod';
import {
  addressSnapshotSchema,
  conflict,
  pageQuery,
  paginated,
  requestIdHeader,
  responses,
} from '@/docs/components';
import { API_V1, bearerAuth, registry } from '@/docs/registry';
import type { EligibilityDTO, TrialDTO } from './trial.mapper';
import { createTrialSchema, outcomeSchema } from './trial.schema';

/**
 * OpenAPI description of at-home trials: check eligibility → book a slot → the
 * pieces are delivered → keep or return each one. Kept pieces become a real
 * order; returned pieces are refunded.
 *
 * The eligibility query is documented by hand rather than from
 * `eligibilityQuerySchema`: that schema `.transform()`s a comma-separated string
 * into an array, and the **wire** format is the string, which is what a client
 * needs to see.
 */

const TAG = 'Trials';

const secured = [{ [bearerAuth.name]: [] }];
const trialParams = z.object({
  id: z.string().uuid().openapi({ description: 'Trial booking id.', example: '3f5a7c9e-1b3d-45f7-a9c1-e3b5d7f9a1c3' }),
});

const trialStatus = z
  .enum(['REQUESTED', 'CONFIRMED', 'OUT_FOR_TRIAL', 'IN_TRIAL', 'COMPLETED', 'CANCELLED'])
  .openapi({
    description:
      'Lifecycle: `REQUESTED` (booked; the charge is not captured yet) → `CONFIRMED` (paid, and the boutique accepted it) → `OUT_FOR_TRIAL` (dispatched) → `IN_TRIAL` (delivered; the keep/return window is open) → `COMPLETED` (outcomes recorded).\n\n' +
      'A conversion is **not** a separate status: a completed trial where something was kept simply carries a non-null `conversionOrderId`. `CANCELLED` is reachable only from `REQUESTED` or `CONFIRMED` — once the pieces are out, resolve it through `/outcome`.',
    example: 'IN_TRIAL',
  });

const trialStoreSchema = z.object({
  id: z.string().uuid(),
  name: z.string().openapi({ example: 'Fabrashion Indiranagar' }),
  code: z.string().openapi({ example: 'BLR01' }),
});

const trialItemSchema = registry.register(
  'TrialItem',
  z
    .object({
      trialItemId: z.string().uuid().openapi({ description: 'Pass this back in `POST /trials/{id}/outcome`.' }),
      variantId: z.string().uuid(),
      productId: z.string().uuid(),
      name: z.string().openapi({ example: 'Cotton Poplin Top' }),
      brand: z.string().nullable(),
      size: z.string().openapi({ example: 'M' }),
      colorName: z.string().openapi({ example: 'Ivory' }),
      colorHex: z.string().nullable(),
      imageUrl: z.string().nullable(),
      quantity: z.number().int().openapi({ example: 1 }),
      unitPricePaise: z.number().int().openapi({ example: 129900 }),
      outcome: z.enum(['PENDING', 'KEPT', 'RETURNED']).openapi({
        description: 'Undecided items auto-**return** when `trialEndsAt` passes.',
        example: 'PENDING',
      }),
    })
    .openapi({ description: 'One piece sent out on trial.' }),
);

export const trialSchema = registry.register(
  'Trial',
  z
    .object({
      id: z.string().uuid(),
      status: trialStatus,
      store: trialStoreSchema.nullable().openapi({ description: 'The boutique fulfilling the trial.' }),
      address: addressSnapshotSchema.openapi({
        description: 'Where the pieces are delivered — snapshotted at booking time.',
      }),
      note: z.string().nullable().openapi({ description: 'Free-text note for the stylist.', example: 'Please ring the bell twice.' }),
      slotStart: z.string().datetime().openapi({ example: '2026-07-16T05:30:00.000Z' }),
      slotEnd: z.string().datetime().openapi({ example: '2026-07-16T07:30:00.000Z' }),
      authAmountPaise: z.number().int().openapi({
        description:
          'The amount authorised on the card to cover the pieces. Returned in full for anything sent back — you are only finally charged for what you keep.',
        example: 259800,
      }),
      paid: z.boolean().openapi({
        description: 'Whether the trial charge has been captured. Staff can only confirm a paid booking.',
        example: true,
      }),
      refundPaise: z.number().int().openapi({ description: 'Refunded so far, for returned pieces.', example: 129900 }),
      trialEndsAt: z.string().datetime().nullable().openapi({
        description:
          'Deadline for the keep/return decision, set once the pieces are delivered. Anything still `PENDING` at this point is auto-returned.',
        example: '2026-07-17T07:30:00.000Z',
      }),
      conversionOrderId: z.string().uuid().nullable().openapi({
        description:
          'The order raised for the KEPT pieces, once outcomes are recorded. Null if nothing was kept. It is created already `PAID` — the trial charge covered it.',
      }),
      itemCount: z.number().int().openapi({ example: 2 }),
      items: z.array(trialItemSchema),
      createdAt: z.string().datetime(),
    })
    .openapi({ description: 'An at-home trial booking.' }),
) satisfies z.ZodType<TrialDTO>;

const paginatedTrialsSchema = paginated('PaginatedTrials', trialSchema);

export const eligibilitySchema = registry.register(
  'TrialEligibility',
  z
    .object({
      addressServiceable: z.boolean().openapi({
        description: 'False when no boutique covers this pincode — hide "Try at Home" entirely.',
        example: true,
      }),
      store: trialStoreSchema.nullable().openapi({ description: 'The boutique that would fulfil it.' }),
      items: z
        .array(
          z.object({
            variantId: z.string().uuid(),
            eligible: z.boolean().openapi({ example: true }),
            reason: z.string().nullable().openapi({
              description: 'Why it is not eligible (out of stock, product not trial-eligible, …). Null when it is.',
              example: null,
            }),
            name: z.string().openapi({ example: 'Cotton Poplin Top' }),
            size: z.string().openapi({ example: 'M' }),
            colorName: z.string().openapi({ example: 'Ivory' }),
            pricePaise: z.number().int().openapi({ example: 129900 }),
          }),
        )
        .openapi({ description: 'Per-variant verdict — render the ineligible ones greyed out with their `reason`.' }),
      slots: z
        .array(
          z.object({
            date: z.string().openapi({ description: 'IST calendar date.', example: '2026-07-16' }),
            windows: z.array(
              z.object({
                slotStart: z.string().datetime(),
                slotEnd: z.string().datetime(),
                available: z.boolean().openapi({ description: 'False when the boutique is already booked out.' }),
              }),
            ),
          }),
        )
        .openapi({ description: 'A 7-day grid of delivery windows. Pass a `slotStart` from here to `POST /trials`.' }),
      limits: z
        .object({
          maxItems: z.number().int().openapi({ example: 5 }),
          maxValuePaise: z.number().int().openapi({ example: 5000000 }),
        })
        .openapi({ description: 'Caps on a single booking — enforce them in the UI before booking.' }),
    })
    .openapi({ description: 'Whether these pieces can be tried at this address, and when.' }),
) satisfies z.ZodType<EligibilityDTO>;

const trialResponse = {
  description: 'The trial booking.',
  headers: requestIdHeader,
  content: { 'application/json': { schema: trialSchema } },
};

registry.registerPath({
  method: 'get',
  path: `${API_V1}/trials/eligibility`,
  operationId: 'getTrialEligibility',
  tags: [TAG],
  summary: 'Can these pieces be tried at this address?',
  security: secured,
  description:
    'Call this **before** showing the Try-at-Home sheet. It answers three things at once: is the address serviceable, is each variant eligible, and which delivery windows are free.\n\n' +
    'A variant can be ineligible because the product is not trial-eligible or because the boutique has no stock; `items[].reason` says which.',
  request: {
    query: z.object({
      variantIds: z.string().openapi({
        description: 'Comma-separated variant UUIDs — **1 to 10** of them.',
        example: '4e5f6a7b-8c9d-4e1f-a2b3-c4d5e6f7a8b9,5f6a7b8c-9d0e-4f2a-b3c4-d5e6f7a8b9c0',
      }),
      addressId: z.string().uuid().openapi({ description: 'A saved address to deliver to.' }),
    }),
  },
  responses: {
    200: {
      description: 'The verdict, plus the slot grid.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: eligibilitySchema } },
    },
    401: responses.unauthorized,
    404: { ...responses.notFound, description: 'No such address on your account.' },
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/trials`,
  operationId: 'createTrial',
  tags: [TAG],
  summary: 'Book an at-home trial',
  security: secured,
  description:
    'Books a delivery window and **holds the stock** at the fulfilling boutique. Use a `slotStart` returned by `GET /trials/eligibility` — an arbitrary timestamp will not match a window.\n\n' +
    'The booking starts `PENDING`: the charge (`authAmountPaise`) has to be captured before the store will confirm it (today via `POST /trials/{id}/confirm-dev`; PhonePe in 4c).\n\n' +
    'Fails with 409 `NOT_SERVICEABLE` if no boutique covers the address, or `INSUFFICIENT_STOCK` if a piece went out of stock between eligibility and booking.',
  request: {
    body: { required: true, content: { 'application/json': { schema: createTrialSchema } } },
  },
  responses: {
    201: { ...trialResponse, description: 'Booked (`PENDING`); stock held.' },
    401: responses.unauthorized,
    404: { ...responses.notFound, description: 'No such address or variant.' },
    409: conflict('No boutique can service this address, or a piece is out of stock.', {
      code: 'NOT_SERVICEABLE',
      message: 'No boutique can service this address for these pieces yet',
    }),
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/trials`,
  operationId: 'listTrials',
  tags: [TAG],
  summary: 'List your trials',
  security: secured,
  description: 'The signed-in user’s trial bookings, newest first.',
  request: { query: z.object(pageQuery) },
  responses: {
    200: {
      description: 'A page of trials.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: paginatedTrialsSchema } },
    },
    401: responses.unauthorized,
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/trials/{id}`,
  operationId: 'getTrial',
  tags: [TAG],
  summary: 'Get one trial',
  security: secured,
  description:
    'Full detail, including each item’s `outcome` and the `trialEndsAt` deadline. This is what the keep/return screen renders.',
  request: { params: trialParams },
  responses: {
    200: trialResponse,
    401: responses.unauthorized,
    404: responses.notFound,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/trials/{id}/outcome`,
  operationId: 'recordTrialOutcome',
  tags: [TAG],
  summary: 'Keep or return each piece',
  security: secured,
  description:
    'Records the decision for the trial. **Every item must be resolved in one call** — send a `KEPT` or `RETURNED` verdict for each `trialItemId`; a partial list is rejected.\n\n' +
    'Kept pieces are rolled into a **conversion order** (its id comes back as `conversionOrderId`) and the held stock is consumed. Returned pieces are refunded and the stock goes back to the boutique.\n\n' +
    'Only valid while the trial is `IN_TRIAL` and before `trialEndsAt`; after the deadline the sweep has already auto-returned everything, and this fails with 409 `ILLEGAL_TRANSITION`.',
  request: {
    params: trialParams,
    body: { required: true, content: { 'application/json': { schema: outcomeSchema } } },
  },
  responses: {
    200: { ...trialResponse, description: 'Outcomes recorded; the trial is now `COMPLETED`.' },
    401: responses.unauthorized,
    404: responses.notFound,
    409: conflict('The trial is not in a state where outcomes can be recorded.', {
      code: 'ILLEGAL_TRANSITION',
      message: 'A COMPLETED trial cannot be advanced',
    }),
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/trials/{id}/cancel`,
  operationId: 'cancelTrial',
  tags: [TAG],
  summary: 'Cancel a trial',
  security: secured,
  description:
    'Cancels the booking, releases the held stock, and refunds any captured charge. Only before the pieces are dispatched — once the trial is under way, resolve it through `/outcome` instead.',
  request: { params: trialParams },
  responses: {
    200: { ...trialResponse, description: 'Cancelled; stock released.' },
    401: responses.unauthorized,
    404: responses.notFound,
    409: conflict('The trial is too far along to cancel.', {
      code: 'ILLEGAL_TRANSITION',
      message: 'An IN_TRIAL trial cannot be cancelled',
    }),
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/trials/{id}/confirm-dev`,
  operationId: 'confirmTrialDev',
  tags: [TAG],
  summary: '[dev only] Capture the trial charge',
  security: secured,
  description:
    '**Development stand-in for the PhonePe trial-charge webhook** (phase 4c). Marks the charge captured (`paid: true`) so the boutique can confirm the booking and the flow can be walked end to end without a payment provider.\n\n' +
    '**Returns 404 when `NODE_ENV=production`.** Do not build client logic on it.',
  request: { params: trialParams },
  responses: {
    200: { ...trialResponse, description: 'Charge captured; `paid` is now true.' },
    401: responses.unauthorized,
    404: { ...responses.notFound, description: 'No such trial — **or the server is in production**, where this route does not exist.' },
    500: responses.internal,
  },
});
