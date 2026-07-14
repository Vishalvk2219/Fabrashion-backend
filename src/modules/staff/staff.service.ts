import { Prisma, type OrderStatus, type Store, type TrialStatus, type User } from '@prisma/client';

import { prisma } from '@/config/db';
import { env } from '@/config/env';
import { AppError, ConflictError, NotFoundError } from '@/lib/errors';
import { type Paginated, paginate } from '@/lib/pagination';
import { istDayStart } from '@/lib/time';
import {
  BOARD_STATUSES,
  STAGE_STATUSES,
  isLowOrOut,
  toInventoryRow,
  toStaffOrder,
  toStaffTrial,
  toStore,
  type StaffInventoryRowDTO,
  type StaffOrderDTO,
  type StaffSummaryDTO,
  type StaffTrialDTO,
} from './staff.mapper';
import { staffRepository } from './staff.repository';
import type { AdjustInventoryInput, StaffOrdersQuery } from './staff.schema';

type Tx = Prisma.TransactionClient;

/** Staff APIs are scoped to the caller's boutique — set by the admin on the account. */
async function requireStore(userId: string): Promise<{ user: User; store: Store }> {
  const user = await staffRepository.findUserWithStore(userId);
  if (!user) throw new NotFoundError('Account not found');
  if (!user.store) {
    throw new AppError(409, 'NO_STORE_ASSIGNED', 'No boutique is assigned to this account yet');
  }
  return { user, store: user.store };
}

const logSource = (store: Store): string => `store:${store.code}`;

/** PAID → FULFILLING ("Packed") → SHIPPED ("Handed Over") → DELIVERED. */
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PAID: 'FULFILLING',
  FULFILLING: 'SHIPPED',
  SHIPPED: 'DELIVERED',
};

/** Trial logistics the store drives: Confirm → Dispatch → Deliver (starts the window). */
const NEXT_TRIAL_STATUS: Partial<Record<TrialStatus, TrialStatus>> = {
  REQUESTED: 'CONFIRMED',
  CONFIRMED: 'OUT_FOR_TRIAL',
  OUT_FOR_TRIAL: 'IN_TRIAL',
};

/**
 * Consume an order's checkout reservation at the warehouse when it gets packed
 * (mirrors checkout's reserve walk). Every decrement is sync-logged; the
 * `pack:<orderId>:<rowId>` event id makes a replayed pack a no-op via the
 * (source, externalEventId) unique constraint.
 */
async function consumeReservedFromWarehouse(
  tx: Tx,
  variantId: string,
  qty: number,
  source: string,
  orderId: string,
): Promise<void> {
  const rows = await tx.inventory.findMany({
    where: { variantId, warehouseId: { not: null }, quantityReserved: { gt: 0 } },
    orderBy: { quantityReserved: 'desc' },
    select: { id: true, quantityReserved: true, version: true },
  });
  let remaining = qty;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, row.quantityReserved);
    const updated = await tx.inventory.updateMany({
      where: { id: row.id, version: row.version, quantityReserved: { gte: take } },
      data: { quantityReserved: { decrement: take }, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ConflictError('Stock changed, please try again');
    await tx.inventorySyncLog.create({
      data: {
        inventoryId: row.id,
        source,
        externalEventId: `pack:${orderId}:${row.id}`,
        changeType: 'ADJUSTMENT',
        deltaQuantity: -take,
        resultingQty: row.quantityReserved - take,
        payload: { orderId, variantId, action: 'pack' } as Prisma.InputJsonObject,
      },
    });
    remaining -= take;
  }
  if (remaining > 0) {
    throw new ConflictError('Reservation missing for this order — reconcile warehouse stock');
  }
}

export const staffService = {
  /** Dashboard numbers for the caller's store; "today" is the IST business day. */
  async summary(userId: string): Promise<StaffSummaryDTO> {
    const { store } = await requireStore(userId);
    const [toPack, ready, tryAtHome, levels, logs] = await Promise.all([
      staffRepository.countOrdersByStatus(STAGE_STATUSES.TO_PACK),
      staffRepository.countOrdersByStatus(STAGE_STATUSES.READY),
      staffRepository.countActiveTrials(store.id),
      staffRepository.listInventoryLevels(store.id),
      staffRepository.listLogsSince(logSource(store), istDayStart()),
    ]);
    const lowStock = levels.filter((r) =>
      isLowOrOut({
        floor: r.quantityAvailable,
        counter: r.quantityOnCounter,
        reserved: r.quantityReserved,
      }),
    ).length;
    // Every stock touch today is one log entry; pack entries carry the orderId.
    const packedOrders = new Set<string>();
    for (const log of logs) {
      const orderId =
        log.payload && typeof log.payload === 'object' && 'orderId' in log.payload
          ? log.payload.orderId
          : null;
      if (typeof orderId === 'string') packedOrders.add(orderId);
    }
    return {
      store: toStore(store),
      toPack,
      ready,
      tryAtHome,
      lowStock,
      updatedToday: logs.length,
      packedToday: packedOrders.size,
    };
  },

  async listInventory(
    userId: string,
    q: string | undefined,
    page: number,
    limit: number,
  ): Promise<Paginated<StaffInventoryRowDTO>> {
    const { store } = await requireStore(userId);
    const [rows, total] = await staffRepository.listInventory(store.id, q, (page - 1) * limit, limit);
    return paginate(rows.map(toInventoryRow), total, page, limit);
  },

  /**
   * Apply bucket deltas to one row at the caller's store. Idempotent by `eventId`
   * (replays return the current state without re-applying — this is what makes the
   * mobile offline queue safe to flush); negativity is rejected atomically.
   */
  async adjustInventory(
    userId: string,
    variantId: string,
    input: AdjustInventoryInput,
  ): Promise<StaffInventoryRowDTO> {
    const { store } = await requireStore(userId);
    const source = logSource(store);
    const row = await staffRepository.findInventoryRow(store.id, variantId);
    if (!row) throw new NotFoundError('This item is not stocked at your store');

    const replay = await staffRepository.findLogByEvent(source, input.eventId);
    if (!replay) {
      const d = {
        floor: input.deltas.floor ?? 0,
        counter: input.deltas.counter ?? 0,
        reserved: input.deltas.reserved ?? 0,
      };
      try {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.inventory.updateMany({
            where: {
              id: row.id,
              ...(d.floor < 0 ? { quantityAvailable: { gte: -d.floor } } : {}),
              ...(d.counter < 0 ? { quantityOnCounter: { gte: -d.counter } } : {}),
              ...(d.reserved < 0 ? { quantityReserved: { gte: -d.reserved } } : {}),
            },
            data: {
              quantityAvailable: { increment: d.floor },
              quantityOnCounter: { increment: d.counter },
              quantityReserved: { increment: d.reserved },
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw new AppError(409, 'INSUFFICIENT_STOCK', 'That change would take stock below zero');
          }
          const after = await tx.inventory.findUniqueOrThrow({
            where: { id: row.id },
            select: { quantityAvailable: true, quantityOnCounter: true, quantityReserved: true },
          });
          await tx.inventorySyncLog.create({
            data: {
              inventoryId: row.id,
              source,
              externalEventId: input.eventId,
              changeType: 'ADJUSTMENT',
              deltaQuantity: d.floor + d.counter + d.reserved,
              resultingQty:
                after.quantityAvailable + after.quantityOnCounter + after.quantityReserved,
              payload: { deltas: input.deltas } as Prisma.InputJsonObject,
            },
          });
        });
      } catch (err) {
        // A concurrent request already applied this eventId (unique-constraint race):
        // treat it as a replay and fall through to return the current state.
        const isReplayRace =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!isReplayRace) throw err;
      }
    }

    const fresh = await staffRepository.findInventoryRow(store.id, variantId);
    if (!fresh) throw new NotFoundError('This item is not stocked at your store');
    return toInventoryRow(fresh);
  },

  async listOrders(userId: string, query: StaffOrdersQuery): Promise<Paginated<StaffOrderDTO>> {
    await requireStore(userId);
    const statuses = query.stage ? STAGE_STATUSES[query.stage] : BOARD_STATUSES;
    if (statuses.length === 0) return paginate([], 0, query.page, query.limit); // Try-at-Home → Phase 6
    const [rows, total] = await staffRepository.listOrders(
      statuses,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return paginate(rows.map(toStaffOrder), total, query.page, query.limit);
  },

  /** Advance one legal step; packing (PAID → FULFILLING) consumes the reservation. */
  async advanceOrder(userId: string, orderId: string): Promise<StaffOrderDTO> {
    const { store } = await requireStore(userId);
    const order = await staffRepository.findOrder(orderId);
    if (!order) throw new NotFoundError('Order not found');
    const next = NEXT_STATUS[order.status];
    if (!next) {
      throw new AppError(409, 'ILLEGAL_TRANSITION', `A ${order.status} order cannot be advanced`);
    }

    await prisma.$transaction(async (tx) => {
      if (order.status === 'PAID') {
        for (const item of order.items) {
          await consumeReservedFromWarehouse(
            tx,
            item.variantId,
            item.quantity,
            logSource(store),
            order.id,
          );
        }
      }
      await tx.order.update({ where: { id: order.id }, data: { status: next } });
    });

    const fresh = await staffRepository.findOrder(orderId);
    if (!fresh) throw new NotFoundError('Order not found');
    return toStaffOrder(fresh);
  },

  /** The Try-at-Home board: active trial bookings this store fulfils. */
  async listTrials(userId: string, page: number, limit: number): Promise<Paginated<StaffTrialDTO>> {
    const { store } = await requireStore(userId);
    const [rows, total] = await staffRepository.listStoreTrials(store.id, (page - 1) * limit, limit);
    return paginate(rows.map(toStaffTrial), total, page, limit);
  },

  /**
   * Advance a trial one logistics step. Confirming needs the charge captured; delivery
   * (IN_TRIAL) starts the keep/return window.
   */
  async advanceTrial(userId: string, trialId: string): Promise<StaffTrialDTO> {
    const { store } = await requireStore(userId);
    const trial = await staffRepository.findTrial(trialId);
    if (!trial || trial.storeId !== store.id) throw new NotFoundError('Trial booking not found');
    const next = NEXT_TRIAL_STATUS[trial.status];
    if (!next) {
      throw new AppError(409, 'ILLEGAL_TRANSITION', `A ${trial.status} trial cannot be advanced`);
    }
    if (trial.status === 'REQUESTED' && !trial.paymentCapturedAt) {
      throw new AppError(409, 'PAYMENT_PENDING', 'The trial charge has not been captured yet');
    }

    const updated = await prisma.trialBooking.updateMany({
      where: { id: trialId, status: trial.status },
      data: {
        status: next,
        ...(next === 'IN_TRIAL'
          ? { trialEndsAt: new Date(Date.now() + env.TRIAL_WINDOW_HOURS * 60 * 60 * 1000) }
          : {}),
      },
    });
    if (updated.count !== 1) throw new ConflictError('This trial was already updated');

    const fresh = await staffRepository.findTrial(trialId);
    if (!fresh) throw new NotFoundError('Trial booking not found');
    return toStaffTrial(fresh);
  },
};
