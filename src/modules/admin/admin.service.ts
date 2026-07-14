import type { Prisma } from '@prisma/client';

import { prisma } from '@/config/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { type Paginated, paginate } from '@/lib/pagination';
import { toSlug } from '@/lib/slug';
import { istDayKey, istDayStart } from '@/lib/time';
import {
  ADMIN_ORDER_STATUS_MAP,
  deltaBps,
  toAdminCatalogRow,
  toAdminOrder,
  toAdminStaff,
  type AdminCatalogRowDTO,
  type AdminOrderDTO,
  type AdminOverviewDTO,
  type AdminStaffDTO,
} from './admin.mapper';
import { adminRepository } from './admin.repository';
import type {
  AdminOrdersQuery,
  CreateProductInput,
  CreateStaffInput,
} from './admin.schema';

const DAY_MS = 24 * 60 * 60 * 1000;

async function uniqueSlug(name: string): Promise<string> {
  const base = toSlug(name) || 'product';
  let candidate = base;
  for (let n = 2; await adminRepository.findProductBySlug(candidate); n++) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}

/** Deterministic, DB-unique SKU: unique slug × per-product-unique size+color. */
const skuFor = (slug: string, v: { size: string; colorName: string }): string =>
  `${slug}-${v.colorName}-${v.size}`.replace(/\s+/g, '').toUpperCase();

export const adminService = {
  /** KPI header + 7-day revenue + channel split, all from realized orders (IST days). */
  async overview(): Promise<AdminOverviewDTO> {
    const now = new Date();
    const todayStart = istDayStart(now);
    const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
    const weekStart = new Date(todayStart.getTime() - 6 * DAY_MS);
    const d30 = new Date(now.getTime() - 30 * DAY_MS);
    const d60 = new Date(now.getTime() - 60 * DAY_MS);

    const [weekOrders, activeNow, activePrev, stores] = await Promise.all([
      adminRepository.realizedOrdersSince(weekStart),
      adminRepository.countActiveCustomers(d30, now),
      adminRepository.countActiveCustomers(d60, d30),
      adminRepository.listStores(),
    ]);

    const sum = (list: { totalPaise: number }[]) => list.reduce((s, o) => s + o.totalPaise, 0);
    const today = weekOrders.filter((o) => o.placedAt && o.placedAt >= todayStart);
    const yesterday = weekOrders.filter(
      (o) => o.placedAt && o.placedAt >= yesterdayStart && o.placedAt < todayStart,
    );

    const revenueTodayPaise = sum(today);
    const ordersToday = today.length;
    const avgOrderPaise = ordersToday ? Math.round(revenueTodayPaise / ordersToday) : 0;
    const revenueYesterday = sum(yesterday);
    const aovYesterday = yesterday.length ? Math.round(revenueYesterday / yesterday.length) : 0;

    // Oldest → today, one bucket per IST day.
    const buckets = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      buckets.set(istDayKey(new Date(todayStart.getTime() - i * DAY_MS)), 0);
    }
    for (const o of weekOrders) {
      if (!o.placedAt) continue;
      const key = istDayKey(o.placedAt);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + o.totalPaise);
    }

    return {
      revenueTodayPaise,
      ordersToday,
      avgOrderPaise,
      activeCustomers: activeNow,
      deltas: {
        revenueBps: deltaBps(revenueTodayPaise, revenueYesterday),
        ordersBps: deltaBps(ordersToday, yesterday.length),
        aovBps: deltaBps(avgOrderPaise, aovYesterday),
        customersBps: deltaBps(activeNow, activePrev),
      },
      revenue7d: [...buckets.entries()].map(([date, revenuePaise]) => ({ date, revenuePaise })),
      // All orders are ONLINE today; store rows report their true 0 until POS
      // sale ingestion lands (plan 06) — no invented splits.
      storePerf: [
        { storeId: null, name: 'Online Store', revenuePaise: sum(weekOrders) },
        ...stores.map((s) => ({ storeId: s.id, name: s.name, revenuePaise: 0 })),
      ],
    };
  },

  async listStaff(page: number, limit: number): Promise<Paginated<AdminStaffDTO>> {
    const [rows, total] = await adminRepository.listStaff((page - 1) * limit, limit);
    return paginate(rows.map(toAdminStaff), total, page, limit);
  },

  /**
   * Add Staff / Send Invite: create the account with its role + boutique. There is no
   * SMS invite yet (MSG91 is a later phase) — the account existing IS the invite; the
   * person signs in with the shared phone-OTP flow and lands in their shell.
   */
  async createStaff(input: CreateStaffInput): Promise<AdminStaffDTO> {
    const phone = `+91${input.phone}`;
    if (await adminRepository.findUserByPhone(phone)) {
      throw new ConflictError('An account with this phone already exists');
    }
    if (input.storeId && !(await adminRepository.findStore(input.storeId))) {
      throw new NotFoundError('Store not found');
    }
    const user = await adminRepository.createStaff({
      fullName: input.fullName,
      phone,
      role: input.role,
      phoneVerified: false, // "Invited" until their first OTP sign-in
      storeId: input.storeId,
      staffPermissions: (input.permissions ?? undefined) as Prisma.InputJsonObject | undefined,
    });
    return toAdminStaff(user);
  },

  async listCatalog(
    q: string | undefined,
    page: number,
    limit: number,
  ): Promise<Paginated<AdminCatalogRowDTO>> {
    const [rows, total] = await adminRepository.listProducts(q, (page - 1) * limit, limit);
    return paginate(rows.map(toAdminCatalogRow), total, page, limit);
  },

  /** The catalog write path: product + variants (+ optional opening warehouse stock). */
  async createProduct(input: CreateProductInput): Promise<AdminCatalogRowDTO> {
    const category = await adminRepository.findCategory(input.categoryId);
    if (!category) throw new NotFoundError('Category not found');
    const warehouse = await adminRepository.findFirstWarehouse();
    if (!warehouse) throw new ConflictError('No warehouse configured — cannot stock the product');

    const slug = await uniqueSlug(input.name);
    const prices = input.variants.map((v) => v.pricePaise);

    const productId = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          categoryId: input.categoryId,
          department: input.department,
          brand: input.brand,
          fit: input.fit,
          material: input.material,
          gstRatePct: input.gstRatePct,
          hsnCode: input.hsnCode,
          trialEligible: input.trialEligible,
          // Denormalized pair read by catalog sort/price filters — every catalog
          // write path must keep it in sync with the variants.
          minPricePaise: Math.min(...prices),
          maxPricePaise: Math.max(...prices),
          variants: {
            create: input.variants.map((v) => ({
              sku: skuFor(slug, v),
              size: v.size,
              colorName: v.colorName,
              colorHex: v.colorHex,
              pricePaise: v.pricePaise,
              mrpPaise: v.mrpPaise,
            })),
          },
          ...(input.imageUrl ? { images: { create: [{ url: input.imageUrl, position: 0 }] } } : {}),
        },
        select: { id: true, variants: { select: { id: true } } },
      });
      // Every variant gets its warehouse row (mirrors the seed), stocked or zero.
      await tx.inventory.createMany({
        data: product.variants.map((v) => ({
          variantId: v.id,
          warehouseId: warehouse.id,
          quantityAvailable: input.initialWarehouseQty,
        })),
      });
      return product.id;
    });

    const created = await adminRepository.findProductForList(productId);
    if (!created) throw new NotFoundError('Product not found');
    return toAdminCatalogRow(created);
  },

  async listOrders(query: AdminOrdersQuery): Promise<Paginated<AdminOrderDTO>> {
    const statuses = query.status
      ? ADMIN_ORDER_STATUS_MAP[query.status]
      : Object.values(ADMIN_ORDER_STATUS_MAP).flat();
    const [rows, total] = await adminRepository.listOrders(
      statuses,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return paginate(rows.map(toAdminOrder), total, query.page, query.limit);
  },
};
