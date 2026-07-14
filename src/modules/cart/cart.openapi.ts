import { z } from '@/lib/zod';
import { conflict, requestIdHeader, responses } from '@/docs/components';
import { API_V1, bearerAuth, registry } from '@/docs/registry';
import type { CartDTO } from './cart.mapper';
import { addItemSchema, updateItemSchema } from './cart.schema';

/**
 * OpenAPI description of the cart. Every route requires auth and operates on the
 * token's own cart — there is no cart id in any path, and one is created lazily
 * on first use.
 */

const TAG = 'Cart';

const secured = [{ [bearerAuth.name]: [] }];
const itemParams = z.object({
  itemId: z.string().uuid().openapi({
    description: 'The **cart line** id (`lines[].itemId`) — not the variant id.',
    example: 'c7e9b1d3-f5a7-4c9e-8b1d-3f5a7c9e1b3d',
  }),
});

const cartLineSchema = registry.register(
  'CartLine',
  z
    .object({
      itemId: z.string().uuid().openapi({ description: 'Pass this to PATCH/DELETE.' }),
      productId: z.string().uuid(),
      variantId: z.string().uuid(),
      name: z.string().openapi({ example: 'Cotton Poplin Top' }),
      brand: z.string().nullable().openapi({ example: 'Fabrashion' }),
      size: z.string().openapi({ example: 'M' }),
      colorName: z.string().openapi({ example: 'Ivory' }),
      colorHex: z.string().nullable().openapi({ example: '#F3EFE7' }),
      imageUrl: z.string().nullable().openapi({ description: 'The product’s hero image.' }),
      pricePaise: z.number().int().openapi({ description: 'Unit price, GST-inclusive.', example: 129900 }),
      mrpPaise: z.number().int().openapi({ example: 159900 }),
      qty: z.number().int().openapi({ example: 2 }),
      availableQty: z.number().int().openapi({
        description:
          'Live stock for this variant. If it drops below `qty`, show the line as over-committed — checkout will reject it.',
        example: 7,
      }),
      lineTotalPaise: z.number().int().openapi({ description: '`pricePaise × qty`.', example: 259800 }),
    })
    .openapi({ description: 'One line of the cart, denormalised so the cart renders without extra fetches.' }),
);

const cartTotalsSchema = registry.register(
  'CartTotals',
  z
    .object({
      count: z.number().int().openapi({ description: 'Total units (sum of `qty`), for the tab badge.', example: 3 }),
      subtotalPaise: z.number().int().openapi({ description: 'GST-inclusive sum of the lines.', example: 259800 }),
      discountPaise: z.number().int().openapi({ description: 'MRP − subtotal. `0` when nothing is discounted.', example: 60000 }),
      taxPaise: z.number().int().openapi({
        description: 'GST **broken out of** the inclusive subtotal — it is not added on top. Display only.',
        example: 27834,
      }),
      shippingPaise: z.number().int().openapi({
        description: 'Flat rate, waived above the free-shipping threshold (and on an empty cart).',
        example: 0,
      }),
      totalPaise: z.number().int().openapi({ description: '`subtotalPaise + shippingPaise`. What the user pays.', example: 259800 }),
    })
    .openapi({
      description:
        'Server-computed money. **Never recompute these client-side** — the server is authoritative, and checkout re-prices from scratch.',
    }),
);

export const cartSchema = registry.register(
  'Cart',
  z
    .object({
      id: z.string().uuid(),
      lines: z.array(cartLineSchema),
      totals: cartTotalsSchema,
    })
    .openapi({ description: 'The signed-in user’s cart. Every mutation returns the whole cart back.' }),
) satisfies z.ZodType<CartDTO>;

/** Every cart route returns the full cart, so they share one 200. */
const cartResponse = {
  description: 'The full cart after the change — render straight from this.',
  headers: requestIdHeader,
  content: { 'application/json': { schema: cartSchema } },
};

const outOfStock = conflict('Not enough stock to satisfy the requested quantity.', {
  code: 'INSUFFICIENT_STOCK',
  message: 'That change would take stock below zero',
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/cart`,
  operationId: 'getCart',
  tags: [TAG],
  summary: 'Get the current cart',
  security: secured,
  description:
    'The signed-in user’s cart, with live `availableQty` on each line and freshly computed totals. An empty cart is a **200 with `lines: []`**, never a 404.',
  responses: {
    200: cartResponse,
    401: responses.unauthorized,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/cart/items`,
  operationId: 'addCartItem',
  tags: [TAG],
  summary: 'Add a variant to the cart',
  security: secured,
  description:
    'Adds `quantity` of a variant. If the variant is **already in the cart the quantities are summed** rather than a second line being created — so this is an increment, not an insert.\n\n' +
    'Stock is checked against live availability; asking for more than exists fails with 409 `INSUFFICIENT_STOCK` and the cart is left untouched.',
  request: {
    body: { required: true, content: { 'application/json': { schema: addItemSchema } } },
  },
  responses: {
    200: cartResponse,
    401: responses.unauthorized,
    404: { ...responses.notFound, description: 'No such variant.' },
    409: outOfStock,
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'patch',
  path: `${API_V1}/cart/items/{itemId}`,
  operationId: 'updateCartItem',
  tags: [TAG],
  summary: 'Set a line’s quantity',
  security: secured,
  description:
    'Sets an **absolute** quantity (not a delta), which is what the stepper on the cart screen wants.\n\n' +
    'Sending `quantity: 0` **removes the line** and still returns 200 — it is equivalent to `DELETE`.',
  request: {
    params: itemParams,
    body: { required: true, content: { 'application/json': { schema: updateItemSchema } } },
  },
  responses: {
    200: cartResponse,
    401: responses.unauthorized,
    404: { ...responses.notFound, description: 'No such line in *your* cart.' },
    409: outOfStock,
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'delete',
  path: `${API_V1}/cart/items/{itemId}`,
  operationId: 'removeCartItem',
  tags: [TAG],
  summary: 'Remove a line',
  security: secured,
  description: 'Drops the line entirely, whatever its quantity, and returns the recomputed cart.',
  request: { params: itemParams },
  responses: {
    200: cartResponse,
    401: responses.unauthorized,
    404: { ...responses.notFound, description: 'No such line in *your* cart.' },
    500: responses.internal,
  },
});
