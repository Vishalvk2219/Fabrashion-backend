import type { OrderStatus } from '@prisma/client';

import type { AdminOrderStatusFilter } from './admin.schema';
import type {
  AdminCatalogRow,
  AdminOrderWithRelations,
  AdminStaffUser,
} from './admin.repository';

// ── Staff directory ──
export type AdminStaffStatus = 'ACTIVE' | 'INVITED';

export interface AdminStaffDTO {
  id: string;
  fullName: string;
  phone: string | null;
  role: string;
  store: { id: string; name: string; code: string } | null;
  /** INVITED until the account's first phone-OTP sign-in verifies the phone. */
  status: AdminStaffStatus;
  createdAt: string;
}

export function toAdminStaff(u: AdminStaffUser): AdminStaffDTO {
  return {
    id: u.id,
    fullName: u.fullName,
    phone: u.phone,
    role: u.role,
    store: u.store ? { id: u.store.id, name: u.store.name, code: u.store.code } : null,
    status: u.phoneVerified ? 'ACTIVE' : 'INVITED',
    createdAt: u.createdAt.toISOString(),
  };
}

// ── Catalog ──
export interface AdminCatalogRowDTO {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  minPricePaise: number;
  maxPricePaise: number;
  /** Sellable units summed across every location (warehouse + stores). */
  totalStock: number;
  isActive: boolean;
  imageUrl: string | null;
}

export function toAdminCatalogRow(p: AdminCatalogRow): AdminCatalogRowDTO {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    brand: p.brand,
    minPricePaise: p.minPricePaise,
    maxPricePaise: p.maxPricePaise,
    totalStock: p.variants.reduce(
      (sum, v) => sum + v.inventory.reduce((s, i) => s + i.quantityAvailable, 0),
      0,
    ),
    isActive: p.isActive,
    imageUrl: p.images[0]?.url ?? null,
  };
}

// ── Orders ──
/** DB statuses backing each design status. PENDING is excluded — not yet a sale. */
export const ADMIN_ORDER_STATUS_MAP: Record<AdminOrderStatusFilter, OrderStatus[]> = {
  NEW: ['PAID'],
  PACKED: ['FULFILLING', 'SHIPPED'],
  DELIVERED: ['DELIVERED'],
  CANCELLED: ['CANCELLED', 'REFUNDED'],
};

export function adminStatusOf(status: OrderStatus): AdminOrderStatusFilter | null {
  for (const [design, statuses] of Object.entries(ADMIN_ORDER_STATUS_MAP)) {
    if (statuses.includes(status)) return design as AdminOrderStatusFilter;
  }
  return null;
}

/** Statuses that count as realized revenue for the KPIs. */
export const REALIZED_STATUSES: OrderStatus[] = ['PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED'];

export interface AdminOrderDTO {
  id: string;
  status: AdminOrderStatusFilter;
  rawStatus: OrderStatus;
  customer: string;
  itemCount: number;
  totalPaise: number;
  source: string;
  placedAt: string | null;
}

export function toAdminOrder(o: AdminOrderWithRelations): AdminOrderDTO {
  const status = adminStatusOf(o.status);
  if (!status) throw new Error(`Order ${o.id} (${o.status}) has no admin status`);
  return {
    id: o.id,
    status,
    rawStatus: o.status,
    customer: o.user.fullName,
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    totalPaise: o.totalPaise,
    source: o.source,
    placedAt: o.placedAt?.toISOString() ?? null,
  };
}

// ── Overview ──
export interface AdminOverviewDTO {
  revenueTodayPaise: number;
  ordersToday: number;
  avgOrderPaise: number;
  /** Distinct buyers over the last 30 days. */
  activeCustomers: number;
  /** Basis points vs the previous period; null when the previous period is zero. */
  deltas: {
    revenueBps: number | null;
    ordersBps: number | null;
    aovBps: number | null;
    customersBps: number | null;
  };
  /** Last 7 IST days, oldest first (today last). */
  revenue7d: { date: string; revenuePaise: number }[];
  /** 7-day realized revenue per channel. Physical-store rows stay 0 until POS sales land. */
  storePerf: { storeId: string | null; name: string; revenuePaise: number }[];
}

/** today vs yesterday (or any pair) in basis points; null when there is no baseline. */
export function deltaBps(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000);
}
