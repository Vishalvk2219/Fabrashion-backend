import { z } from '@/lib/zod';
import { conflict, pageQuery, paginated, requestIdHeader, responses } from '@/docs/components';
import { API_V1, bearerAuth, registry } from '@/docs/registry';
import type { StaffInventoryRowDTO, StaffOrderDTO, StaffSummaryDTO, StaffTrialDTO } from './staff.mapper';
import { STAFF_STAGES, adjustInventorySchema } from './staff.schema';

/**
 * OpenAPI description of the store-ops (back-office) API.
 *
 * Every route here is **STAFF or ADMIN only** and is implicitly scoped to the
 * caller's own boutique — the store is taken from the account, never from a
 * parameter, so one store's staff cannot read or move another's stock. An
 * account with no boutique assigned gets 409 `NO_STORE_ASSIGNED`.
 */

const TAG = 'Staff';

const secured = [{ [bearerAuth.name]: [] }];

/** Raised by every route in this module when the caller has no boutique. */
const noStore = conflict('The signed-in account is not assigned to a boutique.', {
  code: 'NO_STORE_ASSIGNED',
  message: 'No boutique is assigned to this account yet',
});

const storeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().openapi({ example: 'Fabrashion Indiranagar' }),
  code: z.string().openapi({ example: 'BLR01' }),
});

export const staffSummarySchema = registry.register(
  'StaffSummary',
  z
    .object({
      store: storeSchema,
      toPack: z.number().int().openapi({ description: 'Paid orders waiting to be packed.', example: 4 }),
      ready: z.number().int().openapi({ description: 'Packed, awaiting hand-off to the courier.', example: 2 }),
      tryAtHome: z.number().int().openapi({ description: 'Live at-home trials for this boutique.', example: 1 }),
      lowStock: z.number().int().openapi({
        description: 'Lines at or below the low-stock threshold (≤2 units, or zero).',
        example: 6,
      }),
      updatedToday: z.number().int().openapi({ description: 'Stock adjustments made today.', example: 11 }),
      packedToday: z.number().int().openapi({ example: 3 }),
    })
    .openapi({ description: 'The store-ops dashboard tiles, for the caller’s boutique.' }),
) satisfies z.ZodType<StaffSummaryDTO>;

export const staffInventoryRowSchema = registry.register(
  'StaffInventoryRow',
  z
    .object({
      variantId: z.string().uuid(),
      sku: z.string().openapi({ example: 'FB-CPT-IVR-M' }),
      name: z.string().openapi({ example: 'Cotton Poplin Top' }),
      brand: z.string().nullable(),
      size: z.string().openapi({ example: 'M' }),
      colorName: z.string().openapi({ example: 'Ivory' }),
      colorHex: z.string().nullable(),
      pricePaise: z.number().int().openapi({ example: 129900 }),
      floor: z.number().int().openapi({ description: 'On the shop floor — sellable.', example: 5 }),
      counter: z.number().int().openapi({ description: 'Held at the counter for a walk-in.', example: 1 }),
      reserved: z.number().int().openapi({ description: 'Committed to an order or a trial.', example: 2 }),
      version: z.number().int().openapi({
        description: 'Optimistic-concurrency counter, bumped on every adjustment.',
        example: 14,
      }),
      updatedAt: z.string().datetime(),
    })
    .openapi({ description: 'One variant’s stock at the caller’s boutique, split across the three buckets.' }),
) satisfies z.ZodType<StaffInventoryRowDTO>;

export const staffOrderSchema = registry.register(
  'StaffOrder',
  z
    .object({
      id: z.string().uuid(),
      stage: z.enum(STAFF_STAGES).openapi({
        description: 'Which column of the fulfilment board this order sits in.',
        example: 'TO_PACK',
      }),
      status: z
        .enum(['PENDING', 'PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'])
        .openapi({ description: 'The underlying order status behind the stage.', example: 'PAID' }),
      customer: z.string().openapi({ example: 'Aarav Sharma' }),
      firstItemName: z.string().openapi({ description: 'For the card’s one-line preview.', example: 'Cotton Poplin Top' }),
      itemCount: z.number().int().openapi({ example: 2 }),
      totalPaise: z.number().int().openapi({ example: 259800 }),
      placedAt: z.string().datetime().nullable(),
    })
    .openapi({ description: 'A card on the fulfilment board.' }),
) satisfies z.ZodType<StaffOrderDTO>;

export const staffTrialSchema = registry.register(
  'StaffTrial',
  z
    .object({
      id: z.string().uuid(),
      status: z
        .enum(['REQUESTED', 'CONFIRMED', 'OUT_FOR_TRIAL', 'IN_TRIAL', 'COMPLETED', 'CANCELLED'])
        .openapi({ description: 'Where the booking sits in the trial lifecycle.', example: 'CONFIRMED' }),
      customer: z.string().openapi({ example: 'Aarav Sharma' }),
      firstItemName: z.string().openapi({ example: 'Cotton Poplin Top' }),
      itemCount: z.number().int().openapi({ example: 2 }),
      valuePaise: z.number().int().openapi({ description: 'The authorised amount.', example: 259800 }),
      paid: z.boolean().openapi({
        description: 'Whether the charge is captured. **An unpaid booking cannot be advanced** — that is 409 `PAYMENT_PENDING`.',
        example: true,
      }),
      slotStart: z.string().datetime(),
      slotEnd: z.string().datetime(),
      trialEndsAt: z.string().datetime().nullable(),
    })
    .openapi({ description: 'An at-home trial on the boutique’s board.' }),
) satisfies z.ZodType<StaffTrialDTO>;

const paginatedInventorySchema = paginated('PaginatedStaffInventory', staffInventoryRowSchema);
const paginatedStaffOrdersSchema = paginated('PaginatedStaffOrders', staffOrderSchema);
const paginatedStaffTrialsSchema = paginated('PaginatedStaffTrials', staffTrialSchema);

registry.registerPath({
  method: 'get',
  path: `${API_V1}/staff/summary`,
  operationId: 'getStaffSummary',
  tags: [TAG],
  summary: 'Store-ops dashboard',
  security: secured,
  description: 'The counters behind the staff home screen, for the caller’s boutique.',
  responses: {
    200: {
      description: 'The dashboard tiles.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: staffSummarySchema } },
    },
    401: responses.unauthorized,
    403: { ...responses.forbidden, description: 'Not a STAFF or ADMIN account.' },
    409: noStore,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/staff/inventory`,
  operationId: 'listStaffInventory',
  tags: [TAG],
  summary: 'List the boutique’s stock',
  security: secured,
  description:
    'Every stocked variant at the caller’s boutique, with the three buckets (`floor` / `counter` / `reserved`). `q` searches product name and SKU.',
  request: {
    query: z.object({
      q: z.string().optional().openapi({ description: 'Search product name or SKU.', example: 'poplin' }),
      ...pageQuery,
    }),
  },
  responses: {
    200: {
      description: 'A page of stock rows.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: paginatedInventorySchema } },
    },
    401: responses.unauthorized,
    403: responses.forbidden,
    409: noStore,
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'patch',
  path: `${API_V1}/staff/inventory/{variantId}`,
  operationId: 'adjustStaffInventory',
  tags: [TAG],
  summary: 'Adjust stock buckets',
  security: secured,
  description:
    'Moves stock between buckets at the caller’s boutique. Send **deltas, not absolute values** (`floor: -1` means "one fewer on the floor") — that is what lets the mobile app queue adjustments offline and replay them in any order once it reconnects.\n\n' +
    '**Idempotent by `eventId`:** replaying the same `eventId` returns the current row without applying the delta twice, so the offline queue can retry safely. Generate a fresh UUID per user action, not per request attempt.\n\n' +
    'Negativity is guarded atomically inside the transaction: an adjustment that would take any bucket below zero is rejected with 409 `INSUFFICIENT_STOCK` and nothing is written.',
  request: {
    params: z.object({
      variantId: z.string().uuid().openapi({ description: 'The variant whose stock is moving.' }),
    }),
    body: { required: true, content: { 'application/json': { schema: adjustInventorySchema } } },
  },
  responses: {
    200: {
      description: 'The updated row (or the unchanged row, on an idempotent replay).',
      headers: requestIdHeader,
      content: { 'application/json': { schema: staffInventoryRowSchema } },
    },
    401: responses.unauthorized,
    403: responses.forbidden,
    404: { ...responses.notFound, description: 'That variant is not stocked at your boutique.' },
    409: conflict('The delta would take a bucket below zero, or no boutique is assigned.', {
      code: 'INSUFFICIENT_STOCK',
      message: 'That change would take stock below zero',
    }),
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/staff/orders`,
  operationId: 'listStaffOrders',
  tags: [TAG],
  summary: 'The fulfilment board',
  security: secured,
  description:
    'Orders for the caller’s boutique, grouped into board stages. Omit `stage` for the whole board. Unpaid (`PENDING`) orders never appear — they are not sales yet.',
  request: {
    query: z.object({
      stage: z.enum(STAFF_STAGES).optional().openapi({
        description: 'Filter to one column of the board.',
        example: 'TO_PACK',
      }),
      ...pageQuery,
    }),
  },
  responses: {
    200: {
      description: 'A page of board cards.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: paginatedStaffOrdersSchema } },
    },
    401: responses.unauthorized,
    403: responses.forbidden,
    409: noStore,
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/staff/orders/{id}/advance`,
  operationId: 'advanceStaffOrder',
  tags: [TAG],
  summary: 'Advance an order one stage',
  security: secured,
  description:
    'Moves the order to the next stage — `PAID → FULFILLING → SHIPPED → DELIVERED`. There is no target in the body: the server decides the next state, so the board cannot be driven into an invalid one.\n\n' +
    'Reaching `SHIPPED` **consumes the reservation** — the held stock leaves the boutique for good. Advancing an order that is already `DELIVERED` (or was cancelled) fails with 409 `ILLEGAL_TRANSITION`.',
  request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Order id.' }) }) },
  responses: {
    200: {
      description: 'The order in its new stage.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: staffOrderSchema } },
    },
    401: responses.unauthorized,
    403: responses.forbidden,
    404: { ...responses.notFound, description: 'No such order at your boutique.' },
    409: conflict('This order cannot be advanced from its current status.', {
      code: 'ILLEGAL_TRANSITION',
      message: 'A DELIVERED order cannot be advanced',
    }),
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/staff/trials`,
  operationId: 'listStaffTrials',
  tags: [TAG],
  summary: 'The Try-at-Home board',
  security: secured,
  description: 'At-home trials assigned to the caller’s boutique, newest slot first.',
  request: { query: z.object(pageQuery) },
  responses: {
    200: {
      description: 'A page of trials.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: paginatedStaffTrialsSchema } },
    },
    401: responses.unauthorized,
    403: responses.forbidden,
    409: noStore,
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/staff/trials/{id}/advance`,
  operationId: 'advanceStaffTrial',
  tags: [TAG],
  summary: 'Advance a trial one stage',
  security: secured,
  description:
    'Drives the trial through `CONFIRMED → dispatched → delivered`, at which point the customer’s keep/return window opens.\n\n' +
    'A booking whose charge has not been captured **cannot be confirmed** — that returns 409 `PAYMENT_PENDING` (check `paid` on the card before offering the button).',
  request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Trial id.' }) }) },
  responses: {
    200: {
      description: 'The trial in its new stage.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: staffTrialSchema } },
    },
    401: responses.unauthorized,
    403: responses.forbidden,
    404: { ...responses.notFound, description: 'No such trial at your boutique.' },
    409: conflict('The charge is not captured yet, or the trial cannot be advanced.', {
      code: 'PAYMENT_PENDING',
      message: 'The trial charge has not been captured yet',
    }),
    500: responses.internal,
  },
});
