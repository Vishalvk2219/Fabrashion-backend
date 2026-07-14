import type { OrderStatus, Store, TrialStatus } from '@prisma/client';

import type { StaffStage } from './staff.schema';
import type {
  StaffInventoryRow,
  StaffOrderWithRelations,
  StaffTrialWithRelations,
} from './staff.repository';

export interface StaffStoreDTO {
  id: string;
  name: string;
  code: string;
}

export interface StaffSummaryDTO {
  store: StaffStoreDTO;
  toPack: number;
  ready: number;
  tryAtHome: number;
  lowStock: number;
  updatedToday: number;
  packedToday: number;
}

export interface StaffInventoryRowDTO {
  variantId: string;
  sku: string;
  name: string;
  brand: string | null;
  size: string;
  colorName: string;
  colorHex: string | null;
  pricePaise: number;
  floor: number;
  counter: number;
  reserved: number;
  version: number;
  updatedAt: string;
}

export interface StaffOrderDTO {
  id: string;
  stage: StaffStage;
  status: OrderStatus;
  customer: string;
  firstItemName: string;
  itemCount: number;
  totalPaise: number;
  placedAt: string | null;
}

/** Design-stage each order status belongs to (null = not on the fulfilment board). */
export function stageOf(status: OrderStatus): StaffStage | null {
  switch (status) {
    case 'PAID':
      return 'TO_PACK';
    case 'FULFILLING':
      return 'READY';
    case 'SHIPPED':
    case 'DELIVERED':
      return 'HANDED_OVER';
    default:
      return null;
  }
}

/** Statuses backing each stage. TRY_AT_HOME is trial bookings — lands in Phase 6. */
export const STAGE_STATUSES: Record<StaffStage, OrderStatus[]> = {
  TO_PACK: ['PAID'],
  TRY_AT_HOME: [],
  READY: ['FULFILLING'],
  HANDED_OVER: ['SHIPPED', 'DELIVERED'],
};

/** All statuses that appear on the fulfilment board (no stage filter). */
export const BOARD_STATUSES: OrderStatus[] = ['PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED'];

/**
 * Low-stock semantics shared with the mobile `deriveStatus`: out-of-stock counts,
 * "on counter" takes precedence over low, low = ≤ 2 total units.
 */
export function isLowOrOut(row: { floor: number; counter: number; reserved: number }): boolean {
  const total = row.floor + row.counter + row.reserved;
  if (total === 0) return true;
  if (row.counter > 0) return false;
  return total <= 2;
}

export const toStore = (s: Store): StaffStoreDTO => ({ id: s.id, name: s.name, code: s.code });

export function toInventoryRow(row: StaffInventoryRow): StaffInventoryRowDTO {
  return {
    variantId: row.variant.id,
    sku: row.variant.sku,
    name: row.variant.product.name,
    brand: row.variant.product.brand,
    size: row.variant.size,
    colorName: row.variant.colorName,
    colorHex: row.variant.colorHex,
    pricePaise: row.variant.pricePaise,
    floor: row.quantityAvailable,
    counter: row.quantityOnCounter,
    reserved: row.quantityReserved,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface StaffTrialDTO {
  id: string;
  status: TrialStatus;
  customer: string;
  firstItemName: string;
  itemCount: number;
  valuePaise: number;
  /** Charge captured? Staff can only CONFIRM paid bookings. */
  paid: boolean;
  slotStart: string;
  slotEnd: string;
  trialEndsAt: string | null;
}

export function toStaffTrial(t: StaffTrialWithRelations): StaffTrialDTO {
  return {
    id: t.id,
    status: t.status,
    customer: t.user.fullName,
    firstItemName: t.items[0]?.variant.product.name ?? '',
    itemCount: t.items.reduce((n, i) => n + i.quantity, 0),
    valuePaise: t.authAmountPaise,
    paid: t.paymentCapturedAt !== null,
    slotStart: t.slotStart.toISOString(),
    slotEnd: t.slotEnd.toISOString(),
    trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
  };
}

export function toStaffOrder(o: StaffOrderWithRelations): StaffOrderDTO {
  const stage = stageOf(o.status);
  if (!stage) throw new Error(`Order ${o.id} (${o.status}) is not on the fulfilment board`);
  return {
    id: o.id,
    stage,
    status: o.status,
    customer: o.user.fullName,
    firstItemName: o.items[0]?.variant.product.name ?? '',
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    totalPaise: o.totalPaise,
    placedAt: o.placedAt?.toISOString() ?? null,
  };
}
