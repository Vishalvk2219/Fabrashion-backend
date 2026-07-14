import { z } from '@/lib/zod';
import { paginated, requestIdHeader, responses } from '@/docs/components';
import { API_V1, registry } from '@/docs/registry';
import type { AvailabilityDTO, CategoryDTO, ProductDTO } from './catalog.mapper';
import { PRODUCT_SORTS, productListQuerySchema } from './catalog.schema';

/**
 * OpenAPI description of the catalogue — the only fully public part of the API.
 * Request queries reuse the Zod schemas the routes validate with; the response
 * schemas are `satisfies`-checked against the DTOs `catalog.mapper` returns.
 */

const TAG = 'Catalog';

const productId = z.string().openapi({
  description: 'A product **UUID or slug** — both resolve. Slugs keep deep links readable.',
  example: 'cotton-poplin-top',
});

export const categorySchema = registry.register(
  'Category',
  z
    .object({
      id: z.string().uuid().openapi({ example: '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f' }),
      name: z.string().openapi({ example: 'Women' }),
      slug: z.string().openapi({ example: 'women' }),
      parentId: z.string().uuid().nullable().openapi({
        description: 'Null for a top-level category. Filtering by a parent includes its children.',
        example: null,
      }),
    })
    .openapi({ description: 'A node in the (two-level) category tree.' }),
) satisfies z.ZodType<CategoryDTO>;

const productImageSchema = registry.register(
  'ProductImage',
  z.object({
    id: z.string().uuid(),
    url: z.string().url().openapi({ example: 'https://cdn.fabrashion.in/p/poplin-top-1.jpg' }),
    altText: z.string().nullable().openapi({ example: 'Cotton poplin top, ivory' }),
    position: z.number().int().openapi({ description: 'Sort order; 0 is the hero image.', example: 0 }),
  }),
);

const productVariantSchema = registry.register(
  'ProductVariant',
  z
    .object({
      id: z.string().uuid(),
      sku: z.string().openapi({ example: 'FB-CPT-IVR-M' }),
      size: z.string().openapi({ example: 'M' }),
      colorName: z.string().openapi({ example: 'Ivory' }),
      colorHex: z.string().nullable().openapi({ example: '#F3EFE7' }),
      pricePaise: z.number().int().openapi({
        description: 'Selling price, GST-inclusive, in paise (₹1,299 → `129900`).',
        example: 129900,
      }),
      mrpPaise: z.number().int().openapi({
        description: 'List price. `mrpPaise > pricePaise` means it is on discount.',
        example: 159900,
      }),
      availableQty: z.number().int().openapi({
        description:
          'Sellable **right now**, summed across online locations only (every warehouse, plus stores with `syncEnabled`). `0` means out of stock — do not let the user add it to the cart.',
        example: 7,
      }),
    })
    .openapi({ description: 'A buyable size + colour of a product. Carts and orders reference this, never the product.' }),
);

export const productSchema = registry.register(
  'Product',
  z
    .object({
      id: z.string().uuid(),
      name: z.string().openapi({ example: 'Cotton Poplin Top' }),
      slug: z.string().openapi({ example: 'cotton-poplin-top' }),
      description: z.string(),
      brand: z.string().nullable().openapi({ example: 'Fabrashion' }),
      department: z.enum(['MEN', 'WOMEN', 'UNISEX', 'KIDS']).openapi({ example: 'WOMEN' }),
      trialEligible: z.boolean().openapi({
        description: 'Whether this product can be booked for an at-home trial (`POST /trials`).',
        example: true,
      }),
      images: z.array(productImageSchema),
      variants: z.array(productVariantSchema),
    })
    .openapi({ description: 'A catalogue product with its images and buyable variants.' }),
) satisfies z.ZodType<ProductDTO>;

const paginatedProductsSchema = paginated('PaginatedProducts', productSchema);

export const availabilitySchema = registry.register(
  'Availability',
  z
    .object({
      productId: z.string().uuid(),
      variants: z.array(
        z.object({
          variantId: z.string().uuid(),
          availableQty: z.number().int().openapi({ example: 7 }),
          inStock: z.boolean().openapi({ description: 'Convenience for `availableQty > 0`.', example: true }),
        }),
      ),
      stores: z
        .array(
          z.object({
            storeId: z.string().uuid(),
            name: z.string().openapi({ example: 'Fabrashion Indiranagar' }),
            city: z.string().openapi({ example: 'Bengaluru' }),
            inStock: z.boolean().openapi({ description: 'True if the store has any variant in stock.', example: true }),
          }),
        )
        .openapi({
          description:
            'Sync-enabled stores carrying this product. Powers the "available at" strip on the PDP.',
        }),
    })
    .openapi({ description: 'Live stock for one product, per variant and per store.' }),
) satisfies z.ZodType<AvailabilityDTO>;

registry.registerPath({
  method: 'get',
  path: `${API_V1}/categories`,
  operationId: 'listCategories',
  tags: [TAG],
  summary: 'List all categories',
  security: [], // public
  description:
    'The whole category tree as a **flat array** — read `parentId` to nest it. Small and stable, so fetch it once and cache it.',
  responses: {
    200: {
      description: 'Every category, flat.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: z.array(categorySchema) } },
    },
    429: responses.tooManyRequests,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/products`,
  operationId: 'listProducts',
  tags: [TAG],
  summary: 'Search, filter, and sort products',
  security: [], // public
  description:
    'The product listing. Every parameter is optional.\n\n' +
    '`categoryId` matches the **subtree**: passing "Women" also returns products in its child categories.\n\n' +
    'Price filters are in **paise** and compare against the variant price range, so a product matches if *any* of its variants falls in the window. Only active products are returned.',
  request: { query: productListQuerySchema },
  responses: {
    200: {
      description: 'A page of products.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: paginatedProductsSchema } },
    },
    422: responses.validation,
    429: responses.tooManyRequests,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/products/{id}`,
  operationId: 'getProduct',
  tags: [TAG],
  summary: 'Get one product',
  security: [], // public
  description:
    'Full detail for the PDP, including every variant with its live `availableQty`. Accepts either the UUID or the slug.',
  request: { params: z.object({ id: productId }) },
  responses: {
    200: {
      description: 'The product.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: productSchema } },
    },
    404: responses.notFound,
    429: responses.tooManyRequests,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/products/{id}/availability`,
  operationId: 'getProductAvailability',
  tags: [TAG],
  summary: 'Live stock for a product',
  security: [], // public
  description:
    'Just the stock numbers, without re-fetching the whole product — poll this on the PDP rather than `GET /products/{id}`.\n\n' +
    'Returns per-variant availability plus the stores that carry the product. Stock moves, so treat any value as a hint: the authoritative check happens when you add to cart or check out, which is what can still fail with `INSUFFICIENT_STOCK`.',
  request: { params: z.object({ id: productId }) },
  responses: {
    200: {
      description: 'Availability by variant and by store.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: availabilitySchema } },
    },
    404: responses.notFound,
    429: responses.tooManyRequests,
    500: responses.internal,
  },
});

export { PRODUCT_SORTS };
