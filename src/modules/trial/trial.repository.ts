import type { Prisma, Store, TrialStatus } from '@prisma/client';

import { prisma } from '@/config/db';

/** Booking shape the app renders: items with product info, store, conversion orders. */
const trialInclude = {
  items: {
    orderBy: { id: 'asc' },
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          size: true,
          colorName: true,
          colorHex: true,
          product: {
            select: {
              id: true,
              name: true,
              brand: true,
              gstRatePct: true,
              images: { take: 1, orderBy: { position: 'asc' }, select: { url: true } },
            },
          },
        },
      },
    },
  },
  store: { select: { id: true, name: true, code: true } },
  orders: { select: { id: true } },
} satisfies Prisma.TrialBookingInclude;

export type TrialWithRelations = Prisma.TrialBookingGetPayload<{ include: typeof trialInclude }>;

/** Statuses where the booking still owns a stock hold / counts toward the active-bookings cap. */
export const ACTIVE_TRIAL_STATUSES: TrialStatus[] = [
  'REQUESTED',
  'CONFIRMED',
  'OUT_FOR_TRIAL',
  'IN_TRIAL',
];

export const trialRepository = {
  findAddress(id: string, userId: string) {
    return prisma.address.findFirst({ where: { id, userId } });
  },

  /** Sync-enabled stores in the address's city — v1 serviceability (plan 19). */
  listServiceableStores(city: string): Promise<Store[]> {
    return prisma.store.findMany({
      where: { syncEnabled: true, city: { equals: city, mode: 'insensitive' } },
      orderBy: { code: 'asc' },
    });
  },

  /** Variants with product trial gate + per-store availability for the eligibility check. */
  findVariantsForTrial(variantIds: string[]) {
    return prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        sku: true,
        size: true,
        colorName: true,
        pricePaise: true,
        product: {
          select: { id: true, name: true, brand: true, trialEligible: true, isActive: true },
        },
        inventory: {
          select: { storeId: true, quantityAvailable: true },
          where: { storeId: { not: null } },
        },
      },
    });
  },

  countActiveForUser(userId: string): Promise<number> {
    return prisma.trialBooking.count({
      where: { userId, status: { in: ACTIVE_TRIAL_STATUSES } },
    });
  },

  /** Bookings a store has taken inside one calendar day (capacity check). */
  countStoreBookingsBetween(storeId: string, from: Date, to: Date): Promise<number> {
    return prisma.trialBooking.count({
      where: {
        storeId,
        slotStart: { gte: from, lt: to },
        status: { not: 'CANCELLED' },
      },
    });
  },

  findTrial(id: string): Promise<TrialWithRelations | null> {
    return prisma.trialBooking.findUnique({ where: { id }, include: trialInclude });
  },

  listTrials(userId: string, skip: number, take: number): Promise<[TrialWithRelations[], number]> {
    return prisma.$transaction([
      prisma.trialBooking.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: trialInclude,
      }),
      prisma.trialBooking.count({ where: { userId } }),
    ]);
  },

  /** Delivered bookings whose keep/return window has lapsed (sweeper input). */
  listExpiredInTrial(now: Date): Promise<TrialWithRelations[]> {
    return prisma.trialBooking.findMany({
      where: { status: 'IN_TRIAL', trialEndsAt: { lt: now } },
      include: trialInclude,
    });
  },
};

export { trialInclude };
