import type { Address, Prisma } from '@prisma/client';

import { prisma } from '@/config/db';

/** Order shape returned to the client: line snapshots (+ product name/brand/image) and payment. */
const orderInclude = {
  items: {
    orderBy: { id: 'asc' },
    include: {
      variant: {
        select: {
          id: true,
          size: true,
          colorName: true,
          colorHex: true,
          product: {
            select: {
              id: true,
              name: true,
              brand: true,
              images: { take: 1, orderBy: { position: 'asc' }, select: { url: true } },
            },
          },
        },
      },
    },
  },
  payment: true,
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export const checkoutRepository = {
  findAddress(id: string, userId: string): Promise<Address | null> {
    return prisma.address.findFirst({ where: { id, userId } });
  },

  /** An existing PENDING order makes checkout idempotent (avoids a second reservation). */
  findPendingOrder(userId: string): Promise<OrderWithRelations | null> {
    return prisma.order.findFirst({
      where: { userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    });
  },

  findOrder(id: string): Promise<OrderWithRelations | null> {
    return prisma.order.findUnique({ where: { id }, include: orderInclude });
  },

  listOrders(userId: string, skip: number, take: number): Promise<[OrderWithRelations[], number]> {
    return prisma.$transaction([
      prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: orderInclude,
      }),
      prisma.order.count({ where: { userId } }),
    ]);
  },
};
