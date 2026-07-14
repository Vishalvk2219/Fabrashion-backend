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
import type { OrderDTO } from './checkout.mapper';
import { checkoutSchema } from './checkout.schema';

/**
 * OpenAPI description of checkout and the customer's own orders.
 *
 * Note `POST /orders/{id}/confirm-dev`: it is documented because it exists and
 * the app depends on it today, but it 404s when `NODE_ENV=production` — it is a
 * stand-in for the PhonePe capture webhook until phase 4c.
 */

const TAG = 'Orders';

const secured = [{ [bearerAuth.name]: [] }];
const orderParams = z.object({
  id: z.string().uuid().openapi({ description: 'Order id.', example: '7c9e1b3d-5f7a-49c1-8e3b-5d7f9a1c3e5b' }),
});

const orderItemSchema = registry.register(
  'OrderItem',
  z
    .object({
      productId: z.string().uuid(),
      variantId: z.string().uuid(),
      name: z.string().openapi({ example: 'Cotton Poplin Top' }),
      brand: z.string().nullable().openapi({ example: 'Fabrashion' }),
      size: z.string().openapi({ example: 'M' }),
      colorName: z.string().openapi({ example: 'Ivory' }),
      colorHex: z.string().nullable().openapi({ example: '#F3EFE7' }),
      imageUrl: z.string().nullable(),
      quantity: z.number().int().openapi({ example: 2 }),
      unitPricePaise: z.number().int().openapi({
        description: 'Price **as charged**, frozen at purchase. Later price changes never rewrite it.',
        example: 129900,
      }),
      lineTotalPaise: z.number().int().openapi({ example: 259800 }),
    })
    .openapi({ description: 'A purchased line. Snapshotted, so it survives the product being edited or delisted.' }),
);

/**
 * Registered already-nullable. In OpenAPI 3.0 a `$ref` cannot carry `nullable`
 * beside it (that emits a `nullable` with no `type`, which is invalid), so the
 * nullability has to live *in* the component rather than at the reference site.
 */
const orderPaymentSchema = registry.register(
  'OrderPayment',
  z
    .object({
      status: z.string().openapi({ description: 'e.g. `CREATED`, `CAPTURED`, `FAILED`.', example: 'CAPTURED' }),
      provider: z.string().openapi({ example: 'PHONEPE' }),
      amountPaise: z.number().int().openapi({ example: 259800 }),
      method: z.string().nullable().openapi({ description: 'UPI / card / …, once known.', example: 'UPI' }),
    })
    .nullable()
    .openapi({ description: 'The payment attached to the order. **Null until one is created.**' }),
);

export const orderSchema = registry.register(
  'Order',
  z
    .object({
      id: z.string().uuid(),
      status: z.enum([
        'PENDING',
        'PAID',
        'FULFILLING',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
        'REFUNDED',
      ]).openapi({
        description:
          'Lifecycle. A fresh checkout is `PENDING` (reserved, not yet paid); capture moves it to `PAID`, which is when staff see it on the fulfilment board.',
        example: 'PAID',
      }),
      source: z.enum(['ONLINE', 'TRIAL_CONVERSION']).openapi({
        description:
          '`ONLINE` for an app checkout; `TRIAL_CONVERSION` for the order raised automatically from the pieces kept after an at-home trial.',
        example: 'ONLINE',
      }),
      subtotalPaise: z.number().int().openapi({ example: 259800 }),
      taxPaise: z.number().int().openapi({ description: 'GST broken out of the inclusive subtotal.', example: 27834 }),
      shippingPaise: z.number().int().openapi({ example: 0 }),
      totalPaise: z.number().int().openapi({ description: 'What was actually charged.', example: 259800 }),
      itemCount: z.number().int().openapi({ description: 'Total units across the lines.', example: 2 }),
      shippingAddress: addressSnapshotSchema.openapi({
        description:
          'An **immutable snapshot** of the address at purchase time — not a reference. Editing or deleting the saved address never changes a placed order.',
      }),
      placedAt: z.string().datetime().nullable().openapi({
        description: 'When payment was captured. Null while still `PENDING`.',
        example: '2026-07-14T09:12:04.512Z',
      }),
      createdAt: z.string().datetime().openapi({ example: '2026-07-14T09:10:41.002Z' }),
      items: z.array(orderItemSchema),
      payment: orderPaymentSchema,
    })
    .openapi({ description: 'A customer order.' }),
) satisfies z.ZodType<OrderDTO>;

const paginatedOrdersSchema = paginated('PaginatedOrders', orderSchema);

const orderResponse = {
  description: 'The order.',
  headers: requestIdHeader,
  content: { 'application/json': { schema: orderSchema } },
};

registry.registerPath({
  method: 'post',
  path: `${API_V1}/checkout`,
  operationId: 'checkout',
  tags: [TAG],
  summary: 'Place the cart as an order',
  security: secured,
  description:
    'Turns the active cart into a `PENDING` order shipped to one of your saved addresses, and **reserves the stock** for it.\n\n' +
    'Money is re-priced from the database here — whatever totals the client was showing are ignored, so a stale cart cannot underpay. The cart is emptied on success.\n\n' +
    'The order is not a sale yet: it stays `PENDING` until the payment is captured (today via `POST /orders/{id}/confirm-dev`; PhonePe in phase 4c). If a line no longer has stock, the whole checkout fails with 409 `INSUFFICIENT_STOCK` and nothing is reserved.',
  request: {
    body: { required: true, content: { 'application/json': { schema: checkoutSchema } } },
  },
  responses: {
    201: { ...orderResponse, description: 'Order placed (`PENDING`) and stock reserved.' },
    401: responses.unauthorized,
    404: { ...responses.notFound, description: 'No such address on your account.' },
    409: conflict('The cart is empty, or a line no longer has enough stock.', {
      code: 'INSUFFICIENT_STOCK',
      message: 'That change would take stock below zero',
    }),
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/orders`,
  operationId: 'listOrders',
  tags: [TAG],
  summary: 'List your orders',
  security: secured,
  description: 'The signed-in user’s orders, newest first. Only ever your own.',
  request: { query: z.object(pageQuery) },
  responses: {
    200: {
      description: 'A page of orders.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: paginatedOrdersSchema } },
    },
    401: responses.unauthorized,
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/orders/{id}`,
  operationId: 'getOrder',
  tags: [TAG],
  summary: 'Get one order',
  security: secured,
  description:
    'Full order detail. Someone else’s order id returns **404, not 403** — the API does not confirm that an order it will not show you exists.',
  request: { params: orderParams },
  responses: {
    200: orderResponse,
    401: responses.unauthorized,
    404: responses.notFound,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/orders/{id}/cancel`,
  operationId: 'cancelOrder',
  tags: [TAG],
  summary: 'Cancel an order',
  security: secured,
  description:
    'Cancels the order and **releases the reserved stock** back to the warehouse.\n\n' +
    'Only possible before fulfilment starts. Once staff have advanced it past `PAID`, cancelling fails with 409 `ILLEGAL_TRANSITION` — the customer has to go through returns instead.',
  request: { params: orderParams },
  responses: {
    200: { ...orderResponse, description: 'Cancelled; stock released.' },
    401: responses.unauthorized,
    404: responses.notFound,
    409: conflict('This order is too far along to cancel.', {
      code: 'ILLEGAL_TRANSITION',
      message: 'A SHIPPED order cannot be cancelled',
    }),
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/orders/{id}/confirm-dev`,
  operationId: 'confirmOrderDev',
  tags: [TAG],
  summary: '[dev only] Mark an order paid',
  security: secured,
  description:
    '**Development stand-in for the PhonePe capture webhook** (phase 4c). Captures the payment, moving the order `PENDING → PAID` so the rest of the flow — and the staff fulfilment board — can be walked without a payment provider.\n\n' +
    '**Returns 404 when `NODE_ENV=production`**, so it cannot be used to conjure a paid order in a live environment. Do not build client logic on it: real clients will wait for the capture webhook instead.',
  request: { params: orderParams },
  responses: {
    200: { ...orderResponse, description: 'Marked `PAID`.' },
    401: responses.unauthorized,
    404: { ...responses.notFound, description: 'No such order — **or the server is in production**, where this route does not exist.' },
    500: responses.internal,
  },
});
