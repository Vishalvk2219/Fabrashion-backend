import type { OrderStatus, Prisma, Store, User } from '@prisma/client';

import { prisma } from '@/config/db';
import { ACTIVE_TRIAL_STATUSES } from '@/modules/trial/trial.repository';

/** Inventory row + the variant/product fields the store-ops list renders. */
const inventoryInclude = {
  variant: {
    select: {
      id: true,
      sku: true,
      size: true,
      colorName: true,
      colorHex: true,
      pricePaise: true,
      product: { select: { name: true, brand: true } },
    },
  },
} satisfies Prisma.InventoryInclude;

export type StaffInventoryRow = Prisma.InventoryGetPayload<{ include: typeof inventoryInclude }>;

/** Fulfilment-board order shape: customer + line snapshots for the summary line. */
const staffOrderInclude = {
  user: { select: { fullName: true } },
  items: {
    orderBy: { id: 'asc' },
    include: { variant: { select: { product: { select: { name: true } } } } },
  },
} satisfies Prisma.OrderInclude;

export type StaffOrderWithRelations = Prisma.OrderGetPayload<{ include: typeof staffOrderInclude }>;

/** Trial-booking card on the Try-at-Home board: customer + item names + logistics. */
const staffTrialInclude = {
  user: { select: { fullName: true } },
  items: {
    orderBy: { id: 'asc' },
    include: { variant: { select: { product: { select: { name: true } } } } },
  },
} satisfies Prisma.TrialBookingInclude;

export type StaffTrialWithRelations = Prisma.TrialBookingGetPayload<{
  include: typeof staffTrialInclude;
}>;

export const staffRepository = {
  findUserWithStore(userId: string): Promise<(User & { store: Store | null }) | null> {
    return prisma.user.findUnique({ where: { id: userId }, include: { store: true } });
  },

  listInventory(
    storeId: string,
    q: string | undefined,
    skip: number,
    take: number,
  ): Promise<[StaffInventoryRow[], number]> {
    const where: Prisma.InventoryWhereInput = {
      storeId,
      ...(q
        ? {
            variant: {
              OR: [
                { sku: { contains: q, mode: 'insensitive' } },
                { product: { name: { contains: q, mode: 'insensitive' } } },
              ],
            },
          }
        : {}),
    };
    return prisma.$transaction([
      prisma.inventory.findMany({
        where,
        orderBy: { variant: { sku: 'asc' } },
        skip,
        take,
        include: inventoryInclude,
      }),
      prisma.inventory.count({ where }),
    ]);
  },

  findInventoryRow(storeId: string, variantId: string): Promise<StaffInventoryRow | null> {
    return prisma.inventory.findFirst({
      where: { storeId, variantId },
      include: inventoryInclude,
    });
  },

  /** Minimal store rows for the low-stock derivation (a store carries ~dozens of SKUs). */
  listInventoryLevels(
    storeId: string,
  ): Promise<{ quantityAvailable: number; quantityOnCounter: number; quantityReserved: number }[]> {
    return prisma.inventory.findMany({
      where: { storeId },
      select: { quantityAvailable: true, quantityOnCounter: true, quantityReserved: true },
    });
  },

  findLogByEvent(source: string, externalEventId: string) {
    return prisma.inventorySyncLog.findUnique({
      where: { source_externalEventId: { source, externalEventId } },
    });
  },

  /** Today's sync-log payloads for one source — drives the summary activity stats. */
  listLogsSince(source: string, since: Date): Promise<{ payload: Prisma.JsonValue }[]> {
    return prisma.inventorySyncLog.findMany({
      where: { source, createdAt: { gte: since } },
      select: { payload: true },
    });
  },

  countOrdersByStatus(statuses: OrderStatus[]): Promise<number> {
    return prisma.order.count({ where: { status: { in: statuses } } });
  },

  /** Active trial work for this store (empty until Phase 6 ships trials). */
  countActiveTrials(storeId: string): Promise<number> {
    return prisma.trialBooking.count({
      where: { storeId, status: { in: ['CONFIRMED', 'OUT_FOR_TRIAL', 'IN_TRIAL'] } },
    });
  },

  listOrders(
    statuses: OrderStatus[],
    skip: number,
    take: number,
  ): Promise<[StaffOrderWithRelations[], number]> {
    const where: Prisma.OrderWhereInput = { status: { in: statuses } };
    return prisma.$transaction([
      prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip,
        take,
        include: staffOrderInclude,
      }),
      prisma.order.count({ where }),
    ]);
  },

  findOrder(id: string): Promise<StaffOrderWithRelations | null> {
    return prisma.order.findUnique({ where: { id }, include: staffOrderInclude });
  },

  /** Active trial bookings this store fulfils, soonest slot first. */
  listStoreTrials(
    storeId: string,
    skip: number,
    take: number,
  ): Promise<[StaffTrialWithRelations[], number]> {
    const where: Prisma.TrialBookingWhereInput = {
      storeId,
      status: { in: ACTIVE_TRIAL_STATUSES },
    };
    return prisma.$transaction([
      prisma.trialBooking.findMany({
        where,
        orderBy: { slotStart: 'asc' },
        skip,
        take,
        include: staffTrialInclude,
      }),
      prisma.trialBooking.count({ where }),
    ]);
  },

  findTrial(id: string): Promise<StaffTrialWithRelations | null> {
    return prisma.trialBooking.findUnique({ where: { id }, include: staffTrialInclude });
  },
};
