import type { OrderStatus, Prisma, Store, User } from '@prisma/client';

import { prisma } from '@/config/db';
import { REALIZED_STATUSES } from './admin.mapper';

const staffInclude = {
  store: { select: { id: true, name: true, code: true } },
} satisfies Prisma.UserInclude;

export type AdminStaffUser = Prisma.UserGetPayload<{ include: typeof staffInclude }>;

/** Product list row: denormalized prices + per-location stock + cover image. */
const catalogInclude = {
  variants: { select: { inventory: { select: { quantityAvailable: true } } } },
  images: { take: 1, orderBy: { position: 'asc' }, select: { url: true } },
} satisfies Prisma.ProductInclude;

export type AdminCatalogRow = Prisma.ProductGetPayload<{ include: typeof catalogInclude }>;

const orderInclude = {
  user: { select: { fullName: true } },
  items: { select: { quantity: true } },
} satisfies Prisma.OrderInclude;

export type AdminOrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export const adminRepository = {
  // ── Staff directory ──
  listStaff(skip: number, take: number): Promise<[AdminStaffUser[], number]> {
    const where: Prisma.UserWhereInput = { role: { in: ['STAFF', 'ADMIN'] } };
    return prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }],
        skip,
        take,
        include: staffInclude,
      }),
      prisma.user.count({ where }),
    ]);
  },

  findUserByPhone(phone: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { phone } });
  },

  findStore(id: string): Promise<Store | null> {
    return prisma.store.findUnique({ where: { id } });
  },

  listStores(): Promise<Store[]> {
    return prisma.store.findMany({ orderBy: { name: 'asc' } });
  },

  createStaff(data: Prisma.UserUncheckedCreateInput): Promise<AdminStaffUser> {
    return prisma.user.create({ data, include: staffInclude });
  },

  // ── Catalog ──
  listProducts(
    q: string | undefined,
    skip: number,
    take: number,
  ): Promise<[AdminCatalogRow[], number]> {
    const where: Prisma.ProductWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    return prisma.$transaction([
      prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: catalogInclude,
      }),
      prisma.product.count({ where }),
    ]);
  },

  findCategory(id: string) {
    return prisma.category.findUnique({ where: { id } });
  },

  findProductBySlug(slug: string) {
    return prisma.product.findUnique({ where: { slug }, select: { id: true } });
  },

  findFirstWarehouse() {
    return prisma.warehouse.findFirst({ orderBy: { code: 'asc' } });
  },

  findProductForList(id: string): Promise<AdminCatalogRow | null> {
    return prisma.product.findUnique({ where: { id }, include: catalogInclude });
  },

  // ── Orders ──
  listOrders(
    statuses: OrderStatus[],
    skip: number,
    take: number,
  ): Promise<[AdminOrderWithRelations[], number]> {
    const where: Prisma.OrderWhereInput = { status: { in: statuses } };
    return prisma.$transaction([
      prisma.order.findMany({
        where,
        orderBy: [{ placedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: orderInclude,
      }),
      prisma.order.count({ where }),
    ]);
  },

  // ── Overview ──
  /** Realized orders placed at/after `since` — enough to bucket revenue by day. */
  realizedOrdersSince(since: Date): Promise<{ totalPaise: number; placedAt: Date | null }[]> {
    return prisma.order.findMany({
      where: { status: { in: REALIZED_STATUSES }, placedAt: { gte: since } },
      select: { totalPaise: true, placedAt: true },
    });
  },

  /** Distinct buyers with a realized order in [since, until). */
  async countActiveCustomers(since: Date, until: Date): Promise<number> {
    const groups = await prisma.order.groupBy({
      by: ['userId'],
      where: { status: { in: REALIZED_STATUSES }, placedAt: { gte: since, lt: until } },
    });
    return groups.length;
  },
};
