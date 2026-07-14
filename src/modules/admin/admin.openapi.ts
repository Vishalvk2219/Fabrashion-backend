import { z } from '@/lib/zod';
import { pageQuery, paginated, requestIdHeader, responses } from '@/docs/components';
import { API_V1, bearerAuth, registry } from '@/docs/registry';
import type { AdminCatalogRowDTO, AdminOrderDTO, AdminOverviewDTO, AdminStaffDTO } from './admin.mapper';
import { ADMIN_ORDER_STATUSES, createProductSchema, createStaffSchema } from './admin.schema';

/**
 * OpenAPI description of the back-office admin API. **ADMIN only** — a STAFF
 * token gets 403 on every route here. Unlike `/staff/*`, these are not scoped to
 * one boutique: an admin sees the whole business.
 */

const TAG = 'Admin';

const secured = [{ [bearerAuth.name]: [] }];

/** Every route here is admin-gated, so they share one 403. */
const adminOnly = { ...responses.forbidden, description: 'Authenticated, but not an ADMIN account.' };

export const adminOverviewSchema = registry.register(
  'AdminOverview',
  z
    .object({
      revenueTodayPaise: z.number().int().openapi({ description: 'Realized revenue today (IST).', example: 1249700 }),
      ordersToday: z.number().int().openapi({ example: 8 }),
      avgOrderPaise: z.number().int().openapi({ description: 'Average order value today.', example: 156212 }),
      activeCustomers: z.number().int().openapi({ description: 'Distinct buyers in the last 30 days.', example: 214 }),
      deltas: z
        .object({
          revenueBps: z.number().int().nullable().openapi({ example: 1250 }),
          ordersBps: z.number().int().nullable().openapi({ example: -400 }),
          aovBps: z.number().int().nullable().openapi({ example: 210 }),
          customersBps: z.number().int().nullable().openapi({ example: 0 }),
        })
        .openapi({
          description:
            'Change vs the previous period in **basis points** (`1250` = +12.5%). **Null when the previous period was zero** — there is no baseline to compare against, so render a dash, not "0%".',
        }),
      revenue7d: z
        .array(
          z.object({
            date: z.string().openapi({ description: 'IST calendar date.', example: '2026-07-14' }),
            revenuePaise: z.number().int().openapi({ example: 1249700 }),
          }),
        )
        .openapi({ description: 'Last 7 IST days, **oldest first** — today is the last element. Feeds the sparkline.' }),
      storePerf: z
        .array(
          z.object({
            storeId: z.string().uuid().nullable().openapi({ description: 'Null is the online channel.' }),
            name: z.string().openapi({ example: 'Online' }),
            revenuePaise: z.number().int().openapi({ example: 8402100 }),
          }),
        )
        .openapi({
          description:
            '7-day realized revenue per channel. Physical boutiques stay at `0` until POS sales land — that is expected, not a bug.',
        }),
    })
    .openapi({ description: 'Business KPIs for the admin home screen. Revenue counts PAID and beyond — never PENDING.' }),
) satisfies z.ZodType<AdminOverviewDTO>;

export const adminStaffSchema = registry.register(
  'AdminStaff',
  z
    .object({
      id: z.string().uuid(),
      fullName: z.string().openapi({ example: 'Priya Nair' }),
      phone: z.string().nullable().openapi({ example: '+919000000002' }),
      role: z.string().openapi({ example: 'STAFF' }),
      store: z
        .object({ id: z.string().uuid(), name: z.string(), code: z.string().openapi({ example: 'BLR01' }) })
        .nullable()
        .openapi({ description: 'The assigned boutique. Null for an admin, who is not tied to one.' }),
      status: z.enum(['ACTIVE', 'INVITED']).openapi({
        description:
          '**Derived, not stored:** `INVITED` until the account’s first phone-OTP sign-in verifies the number; `ACTIVE` after. There is no invite email to resend — they simply log in with their phone.',
        example: 'ACTIVE',
      }),
      createdAt: z.string().datetime(),
    })
    .openapi({ description: 'A member of the team.' }),
) satisfies z.ZodType<AdminStaffDTO>;

export const adminCatalogRowSchema = registry.register(
  'AdminCatalogRow',
  z
    .object({
      id: z.string().uuid(),
      name: z.string().openapi({ example: 'Cotton Poplin Top' }),
      slug: z.string().openapi({ example: 'cotton-poplin-top' }),
      brand: z.string().nullable(),
      minPricePaise: z.number().int().openapi({ description: 'Cheapest variant.', example: 129900 }),
      maxPricePaise: z.number().int().openapi({ description: 'Dearest variant.', example: 149900 }),
      totalStock: z.number().int().openapi({
        description: 'Sellable units across **every** location (warehouse + all stores) — not just online ones.',
        example: 42,
      }),
      isActive: z.boolean().openapi({ description: 'Inactive products are hidden from the public catalogue.' }),
      imageUrl: z.string().nullable(),
    })
    .openapi({ description: 'A row of the admin catalogue table.' }),
) satisfies z.ZodType<AdminCatalogRowDTO>;

export const adminOrderSchema = registry.register(
  'AdminOrder',
  z
    .object({
      id: z.string().uuid(),
      status: z.enum(ADMIN_ORDER_STATUSES).openapi({
        description: 'The **design** status the admin table groups by.',
        example: 'NEW',
      }),
      rawStatus: z
        .enum(['PENDING', 'PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'])
        .openapi({
          description: 'The underlying order status, when you need the precise state behind the design one.',
          example: 'PAID',
        }),
      customer: z.string().openapi({ example: 'Aarav Sharma' }),
      itemCount: z.number().int().openapi({ example: 2 }),
      totalPaise: z.number().int().openapi({ example: 259800 }),
      source: z.string().openapi({ example: 'ONLINE' }),
      placedAt: z.string().datetime().nullable(),
    })
    .openapi({
      description:
        'An order as the admin table shows it. Several raw statuses fold into one design status (`FULFILLING` and `SHIPPED` are both `PACKED`).',
    }),
) satisfies z.ZodType<AdminOrderDTO>;

const paginatedAdminStaffSchema = paginated('PaginatedAdminStaff', adminStaffSchema);
const paginatedAdminCatalogSchema = paginated('PaginatedAdminCatalog', adminCatalogRowSchema);
const paginatedAdminOrdersSchema = paginated('PaginatedAdminOrders', adminOrderSchema);

registry.registerPath({
  method: 'get',
  path: `${API_V1}/admin/overview`,
  operationId: 'getAdminOverview',
  tags: [TAG],
  summary: 'Business KPIs',
  security: secured,
  description: 'Revenue, orders, AOV, and active customers, with period-over-period deltas and a 7-day series.',
  responses: {
    200: {
      description: 'The KPI snapshot.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: adminOverviewSchema } },
    },
    401: responses.unauthorized,
    403: adminOnly,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/admin/staff`,
  operationId: 'listAdminStaff',
  tags: [TAG],
  summary: 'List the team',
  security: secured,
  description: 'Every STAFF and ADMIN account, with its boutique and derived Active/Invited status.',
  request: { query: z.object(pageQuery) },
  responses: {
    200: {
      description: 'A page of team members.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: paginatedAdminStaffSchema } },
    },
    401: responses.unauthorized,
    403: adminOnly,
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/admin/staff`,
  operationId: 'createAdminStaff',
  tags: [TAG],
  summary: 'Add a team member',
  security: secured,
  description:
    'Creates a STAFF or ADMIN account for a phone number. There is no password and no invite link: **the person signs in through the same phone-OTP flow as everyone else**, and the role stored here decides which shell they land in.\n\n' +
    'They show as `INVITED` until that first sign-in. Assign `storeId` for STAFF — without a boutique, every `/staff/*` call they make fails with `NO_STORE_ASSIGNED`.\n\n' +
    '`permissions` is persisted verbatim for the UI’s toggles but is **not enforced**: authorization is role-based today.',
  request: {
    body: { required: true, content: { 'application/json': { schema: createStaffSchema } } },
  },
  responses: {
    201: {
      description: 'Account created.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: adminStaffSchema } },
    },
    401: responses.unauthorized,
    403: adminOnly,
    409: { ...responses.conflict, description: 'That phone number already has an account.' },
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/admin/catalog`,
  operationId: 'listAdminCatalog',
  tags: [TAG],
  summary: 'List the catalogue',
  security: secured,
  description:
    'The admin view of every product — **including inactive ones**, which the public `GET /products` hides — with total stock across all locations. `q` searches name and brand.',
  request: {
    query: z.object({
      q: z.string().optional().openapi({ description: 'Search name or brand.', example: 'poplin' }),
      ...pageQuery,
    }),
  },
  responses: {
    200: {
      description: 'A page of catalogue rows.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: paginatedAdminCatalogSchema } },
    },
    401: responses.unauthorized,
    403: adminOnly,
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/admin/products`,
  operationId: 'createAdminProduct',
  tags: [TAG],
  summary: 'Create a product',
  security: secured,
  description:
    'The catalogue write path — creates a product with all its variants in one call, and opens stock for each of them at the main warehouse (`initialWarehouseQty`).\n\n' +
    'The slug is derived from the name and de-duplicated server-side. Every size + colour pair must be unique. Images are a **hosted URL** for now; S3 presigned uploads land in a later phase.',
  request: {
    body: { required: true, content: { 'application/json': { schema: createProductSchema } } },
  },
  responses: {
    201: {
      description: 'Product created, with stock opened at the warehouse.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: adminCatalogRowSchema } },
    },
    401: responses.unauthorized,
    403: adminOnly,
    404: { ...responses.notFound, description: 'No such category.' },
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/admin/orders`,
  operationId: 'listAdminOrders',
  tags: [TAG],
  summary: 'List all orders',
  security: secured,
  description:
    'Every order across the business, newest first, filterable by design status. **`PENDING` orders are never returned** — an unpaid order is not a sale, so it would distort the table and the KPIs alike.',
  request: {
    query: z.object({
      status: z.enum(ADMIN_ORDER_STATUSES).optional().openapi({
        description: 'Filter by design status.',
        example: 'NEW',
      }),
      ...pageQuery,
    }),
  },
  responses: {
    200: {
      description: 'A page of orders.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: paginatedAdminOrdersSchema } },
    },
    401: responses.unauthorized,
    403: adminOnly,
    422: responses.validation,
    500: responses.internal,
  },
});
