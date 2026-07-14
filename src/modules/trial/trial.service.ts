import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/config/db';
import { env } from '@/config/env';
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { gstFromInclusive } from '@/lib/money';
import { type Paginated, paginate } from '@/lib/pagination';
import { istDayKey, istDayStart } from '@/lib/time';
import { addressSnapshot } from '@/modules/checkout/checkout.mapper';
import { toTrial, type EligibilityDTO, type TrialDTO } from './trial.mapper';
import { trialRepository, type TrialWithRelations } from './trial.repository';
import type { CreateTrialInput, EligibilityQuery, OutcomeInput } from './trial.schema';

type Tx = Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Fixed 2-hour delivery windows, hours in IST (plan 19 logistics: 11–1, 2–4, 5–7). */
const SLOT_START_HOURS_IST = [11, 14, 17];
const SLOT_LENGTH_HOURS = 2;
const SLOT_DAYS_AHEAD = 7;

type SlotWindow = { slotStart: Date; slotEnd: Date };
type SlotDay = { date: string; dayStart: Date; windows: SlotWindow[] };

/** The bookable grid: 7 IST days starting tomorrow × the fixed windows. */
function slotGrid(now: Date = new Date()): SlotDay[] {
  const todayStart = istDayStart(now);
  const days: SlotDay[] = [];
  for (let d = 1; d <= SLOT_DAYS_AHEAD; d++) {
    const dayStart = new Date(todayStart.getTime() + d * DAY_MS);
    days.push({
      date: istDayKey(dayStart),
      dayStart,
      windows: SLOT_START_HOURS_IST.map((h) => ({
        slotStart: new Date(dayStart.getTime() + h * HOUR_MS),
        slotEnd: new Date(dayStart.getTime() + (h + SLOT_LENGTH_HOURS) * HOUR_MS),
      })),
    });
  }
  return days;
}

type TrialVariant = Awaited<ReturnType<typeof trialRepository.findVariantsForTrial>>[number];

/** Why a variant can't be trialled (null = eligible). */
function ineligibleReason(v: TrialVariant, storeId: string | null, qty: number): string | null {
  if (!v.product.isActive) return 'This piece is no longer available';
  if (!v.product.trialEligible) return 'Not available for home trial';
  if (!storeId) return 'No boutique services this address yet';
  const atStore = v.inventory.find((r) => r.storeId === storeId);
  if (!atStore || atStore.quantityAvailable < qty) return 'Out of stock at your boutique';
  return null;
}

/** First same-city sync-enabled store that can stock the whole basket. */
async function pickStore(city: string, items: { variantId: string; qty: number }[], variants: TrialVariant[]) {
  const stores = await trialRepository.listServiceableStores(city);
  const byId = new Map(variants.map((v) => [v.id, v]));
  return (
    stores.find((store) =>
      items.every((item) => {
        const row = byId.get(item.variantId)?.inventory.find((r) => r.storeId === store.id);
        return (row?.quantityAvailable ?? 0) >= item.qty;
      }),
    ) ?? null
  );
}

/**
 * Move a variant's stock between buckets at the fulfilling store, version-guarded and
 * sync-logged. Negative results are impossible: guards reject in the same UPDATE.
 */
async function moveStoreStock(
  tx: Tx,
  storeId: string,
  variantId: string,
  deltas: { available: number; onTrial: number },
  log: { event: string; trialId: string; action: string },
): Promise<void> {
  const row = await tx.inventory.findFirst({
    where: { storeId, variantId },
    select: { id: true, version: true, quantityAvailable: true, quantityOnTrial: true },
  });
  if (!row) throw new ConflictError('Stock changed, please try again');
  const updated = await tx.inventory.updateMany({
    where: {
      id: row.id,
      version: row.version,
      ...(deltas.available < 0 ? { quantityAvailable: { gte: -deltas.available } } : {}),
      ...(deltas.onTrial < 0 ? { quantityOnTrial: { gte: -deltas.onTrial } } : {}),
    },
    data: {
      quantityAvailable: { increment: deltas.available },
      quantityOnTrial: { increment: deltas.onTrial },
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new ConflictError('Stock changed, please try again');
  await tx.inventorySyncLog.create({
    data: {
      inventoryId: row.id,
      source: 'trial',
      externalEventId: log.event,
      changeType: deltas.available > 0 ? 'RETURN' : 'ADJUSTMENT',
      deltaQuantity: deltas.available,
      resultingQty: row.quantityAvailable + deltas.available,
      payload: { trialId: log.trialId, variantId, action: log.action } as Prisma.InputJsonObject,
    },
  });
}

async function loadTrial(id: string): Promise<TrialDTO> {
  const trial = await trialRepository.findTrial(id);
  if (!trial) throw new NotFoundError('Trial booking not found');
  return toTrial(trial);
}

/**
 * Complete a booking inside a transaction: claim it (status-guarded, so a concurrent
 * sweeper/outcome can't double-apply), record outcomes, move stock, convert KEPT items
 * into a PAID order, record the refund for RETURNED value. Shared by the customer
 * outcome endpoint and the auto-return sweeper.
 */
async function completeBookingTx(
  tx: Tx,
  booking: TrialWithRelations,
  outcomeOf: (trialItemId: string) => 'KEPT' | 'RETURNED',
): Promise<void> {
  const kept = booking.items.filter((i) => outcomeOf(i.id) === 'KEPT');
  const returned = booking.items.filter((i) => outcomeOf(i.id) === 'RETURNED');
  const keptTotal = kept.reduce((s, i) => s + i.unitPricePaise * i.quantity, 0);
  const returnedTotal = returned.reduce((s, i) => s + i.unitPricePaise * i.quantity, 0);
  const paid = booking.paymentCapturedAt !== null;

  const claimed = await tx.trialBooking.updateMany({
    where: { id: booking.id, status: 'IN_TRIAL' },
    data: { status: 'COMPLETED', refundPaise: paid ? returnedTotal : 0 },
  });
  if (claimed.count !== 1) throw new ConflictError('This trial was already completed');

  for (const item of booking.items) {
    await tx.trialItem.update({
      where: { id: item.id },
      data: { outcome: outcomeOf(item.id) },
    });
  }

  if (!booking.storeId) throw new ConflictError('Booking has no fulfilling store');
  for (const item of kept) {
    await moveStoreStock(
      tx,
      booking.storeId,
      item.variant.id,
      { available: 0, onTrial: -item.quantity },
      { event: `trial-keep:${booking.id}:${item.id}`, trialId: booking.id, action: 'trial_keep' },
    );
  }
  for (const item of returned) {
    await moveStoreStock(
      tx,
      booking.storeId,
      item.variant.id,
      { available: item.quantity, onTrial: -item.quantity },
      { event: `trial-return:${booking.id}:${item.id}`, trialId: booking.id, action: 'trial_return' },
    );
  }

  if (kept.length > 0) {
    const taxPaise = kept.reduce(
      (s, i) => s + gstFromInclusive(i.unitPricePaise * i.quantity, i.variant.product.gstRatePct),
      0,
    );
    await tx.order.create({
      data: {
        userId: booking.userId,
        status: 'PAID', // the trial charge already covers the kept value
        source: 'TRIAL_CONVERSION',
        subtotalPaise: keptTotal,
        taxPaise,
        shippingPaise: 0, // pieces are already with the customer
        totalPaise: keptTotal,
        shippingAddress: booking.address as Prisma.InputJsonObject,
        trialBookingId: booking.id,
        placedAt: new Date(),
        items: {
          create: kept.map((i) => ({
            variantId: i.variant.id,
            quantity: i.quantity,
            unitPricePaise: i.unitPricePaise,
          })),
        },
        payment: {
          create: {
            amountPaise: keptTotal,
            provider: 'phonepe',
            providerRef: booking.paymentRef,
            status: 'CAPTURED',
            capturedAt: new Date(),
          },
        },
      },
    });
  }
}

export const trialService = {
  /** Which variants can be trialled at this address + the bookable slot grid. */
  async eligibility(userId: string, query: EligibilityQuery): Promise<EligibilityDTO> {
    const address = await trialRepository.findAddress(query.addressId, userId);
    if (!address) throw new NotFoundError('Address not found');
    const variants = await trialRepository.findVariantsForTrial(query.variantIds);
    if (variants.length !== query.variantIds.length) throw new NotFoundError('Variant not found');

    const items = query.variantIds.map((id) => ({ variantId: id, qty: 1 }));
    const store = await pickStore(address.city, items, variants);

    const grid = slotGrid();
    const slots = [];
    for (const day of grid) {
      const available = store
        ? (await trialRepository.countStoreBookingsBetween(
            store.id,
            day.dayStart,
            new Date(day.dayStart.getTime() + DAY_MS),
          )) < env.TRIAL_SLOT_CAPACITY
        : false;
      slots.push({
        date: day.date,
        windows: day.windows.map((w) => ({
          slotStart: w.slotStart.toISOString(),
          slotEnd: w.slotEnd.toISOString(),
          available,
        })),
      });
    }

    return {
      addressServiceable: store !== null,
      store: store ? { id: store.id, name: store.name, code: store.code } : null,
      items: variants.map((v) => ({
        variantId: v.id,
        eligible: ineligibleReason(v, store?.id ?? null, 1) === null,
        reason: ineligibleReason(v, store?.id ?? null, 1),
        name: v.product.name,
        size: v.size,
        colorName: v.colorName,
        pricePaise: v.pricePaise,
      })),
      slots,
      limits: { maxItems: env.TRIAL_MAX_ITEMS, maxValuePaise: env.TRIAL_MAX_VALUE_PAISE },
    };
  },

  /** Book: validate limits + slot + store, hold stock, create REQUESTED (charge pending). */
  async createBooking(userId: string, input: CreateTrialInput): Promise<TrialDTO> {
    const address = await trialRepository.findAddress(input.addressId, userId);
    if (!address) throw new NotFoundError('Address not found');

    const totalQty = input.items.reduce((s, i) => s + i.qty, 0);
    if (totalQty > env.TRIAL_MAX_ITEMS) {
      throw new BadRequestError(`A trial can include at most ${env.TRIAL_MAX_ITEMS} pieces`);
    }
    if ((await trialRepository.countActiveForUser(userId)) >= env.TRIAL_MAX_ACTIVE) {
      throw new ConflictError('You already have an active trial — complete it first');
    }

    const variants = await trialRepository.findVariantsForTrial(input.items.map((i) => i.variantId));
    if (variants.length !== input.items.length) throw new NotFoundError('Variant not found');
    const byId = new Map(variants.map((v) => [v.id, v]));
    const authAmountPaise = input.items.reduce(
      (s, i) => s + (byId.get(i.variantId)?.pricePaise ?? 0) * i.qty,
      0,
    );
    if (authAmountPaise > env.TRIAL_MAX_VALUE_PAISE) {
      throw new BadRequestError('This trial exceeds the maximum trial value');
    }

    const store = await pickStore(address.city, input.items, variants);
    if (!store) {
      throw new AppError(409, 'NOT_SERVICEABLE', 'No boutique can service this address for these pieces yet');
    }
    for (const item of input.items) {
      const reason = ineligibleReason(byId.get(item.variantId)!, store.id, item.qty);
      if (reason) throw new BadRequestError(reason);
    }

    // Slot must be one of the published windows, in the future, with day capacity left.
    const window = slotGrid()
      .flatMap((d) => d.windows)
      .find((w) => w.slotStart.getTime() === input.slotStart.getTime());
    if (!window) throw new BadRequestError('Pick one of the available delivery slots');
    const dayStart = istDayStart(window.slotStart);
    const dayBookings = await trialRepository.countStoreBookingsBetween(
      store.id,
      dayStart,
      new Date(dayStart.getTime() + DAY_MS),
    );
    if (dayBookings >= env.TRIAL_SLOT_CAPACITY) {
      throw new ConflictError('That day is fully booked at your boutique — pick another');
    }

    const bookingId = await prisma.$transaction(async (tx) => {
      const booking = await tx.trialBooking.create({
        data: {
          userId,
          status: 'REQUESTED',
          address: addressSnapshot(address) as Prisma.InputJsonObject,
          note: input.note,
          slotStart: window.slotStart,
          slotEnd: window.slotEnd,
          storeId: store.id,
          authAmountPaise,
          items: {
            create: input.items.map((i) => ({
              variantId: i.variantId,
              quantity: i.qty,
              unitPricePaise: byId.get(i.variantId)!.pricePaise,
            })),
          },
        },
      });
      for (const item of input.items) {
        await moveStoreStock(
          tx,
          store.id,
          item.variantId,
          { available: -item.qty, onTrial: item.qty },
          { event: `trial-hold:${booking.id}:${item.variantId}`, trialId: booking.id, action: 'trial_hold' },
        );
      }
      return booking.id;
    });

    return loadTrial(bookingId);
  },

  /** The single, idempotent trial capture path — PhonePe's webhook calls this in 4c. */
  async markTrialPaid(id: string): Promise<TrialDTO> {
    const trial = await trialRepository.findTrial(id);
    if (!trial) throw new NotFoundError('Trial booking not found');
    if (!trial.paymentCapturedAt) {
      await prisma.trialBooking.update({
        where: { id },
        data: { paymentCapturedAt: new Date(), paymentRef: `dev:${randomUUID()}` },
      });
    }
    return loadTrial(id);
  },

  async listTrials(userId: string, page: number, limit: number): Promise<Paginated<TrialDTO>> {
    await this.sweepExpiredTrials(); // lazy auto-return before serving reads
    const [rows, total] = await trialRepository.listTrials(userId, (page - 1) * limit, limit);
    return paginate(rows.map(toTrial), total, page, limit);
  },

  async getTrial(userId: string, id: string): Promise<TrialDTO> {
    await this.sweepExpiredTrials();
    const trial = await trialRepository.findTrial(id);
    if (!trial) throw new NotFoundError('Trial booking not found');
    if (trial.userId !== userId) throw new ForbiddenError();
    return toTrial(trial);
  },

  /** Record keep/return for every piece; kept ones become a PAID conversion order. */
  async recordOutcome(userId: string, id: string, input: OutcomeInput): Promise<TrialDTO> {
    const trial = await trialRepository.findTrial(id);
    if (!trial) throw new NotFoundError('Trial booking not found');
    if (trial.userId !== userId) throw new ForbiddenError();
    if (trial.status !== 'IN_TRIAL') {
      throw new ConflictError('Outcomes can be recorded once the trial is delivered');
    }
    const outcomes = new Map(input.items.map((i) => [i.trialItemId, i.outcome]));
    const allCovered =
      trial.items.length === input.items.length && trial.items.every((i) => outcomes.has(i.id));
    if (!allCovered) throw new BadRequestError('Every piece needs a keep or return decision');

    await prisma.$transaction(async (tx) => {
      await completeBookingTx(tx, trial, (itemId) => outcomes.get(itemId)!);
    });
    return loadTrial(id);
  },

  /** Cancel before dispatch: release every hold, record a full refund if already charged. */
  async cancelBooking(userId: string, id: string): Promise<TrialDTO> {
    const trial = await trialRepository.findTrial(id);
    if (!trial) throw new NotFoundError('Trial booking not found');
    if (trial.userId !== userId) throw new ForbiddenError();
    if (trial.status !== 'REQUESTED' && trial.status !== 'CONFIRMED') {
      throw new ConflictError('This trial is already on its way — record outcomes instead');
    }

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.trialBooking.updateMany({
        where: { id, status: { in: ['REQUESTED', 'CONFIRMED'] } },
        data: {
          status: 'CANCELLED',
          refundPaise: trial.paymentCapturedAt ? trial.authAmountPaise : 0,
        },
      });
      if (claimed.count !== 1) throw new ConflictError('This trial was already updated');
      if (!trial.storeId) return;
      for (const item of trial.items) {
        await moveStoreStock(
          tx,
          trial.storeId,
          item.variant.id,
          { available: item.quantity, onTrial: -item.quantity },
          { event: `trial-cancel:${trial.id}:${item.id}`, trialId: trial.id, action: 'trial_cancel' },
        );
      }
    });
    return loadTrial(id);
  },

  /** Plan 07 policy: past the window, undecided pieces are treated as RETURNED. */
  async sweepExpiredTrials(now: Date = new Date()): Promise<number> {
    const expired = await trialRepository.listExpiredInTrial(now);
    let swept = 0;
    for (const trial of expired) {
      try {
        await prisma.$transaction(async (tx) => {
          await completeBookingTx(tx, trial, () => 'RETURNED');
        });
        swept += 1;
      } catch {
        // Claimed by a concurrent outcome/sweep — nothing to do.
      }
    }
    return swept;
  },
};
