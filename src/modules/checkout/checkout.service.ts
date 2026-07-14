import type { Prisma } from '@prisma/client';

import { prisma } from '@/config/db';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { type Paginated, paginate } from '@/lib/pagination';
import { computeCartTotals } from '@/modules/cart/cart.mapper';
import { addressSnapshot, type OrderDTO, toOrder } from './checkout.mapper';
import { checkoutRepository } from './checkout.repository';

type Tx = Prisma.TransactionClient;

/** Cart shape needed to price + snapshot lines inside the checkout transaction. */
const cartLineInclude = {
  items: {
    include: { variant: { include: { product: { select: { gstRatePct: true } } } } },
  },
} satisfies Prisma.CartInclude;

/**
 * Reserve `qty` of a variant from warehouse stock (online orders ship from the warehouse): move
 * available → reserved, guarded by the row `version` for optimistic concurrency.
 */
async function reserveFromWarehouse(tx: Tx, variantId: string, qty: number): Promise<void> {
  const rows = await tx.inventory.findMany({
    where: { variantId, warehouseId: { not: null } },
    orderBy: { quantityAvailable: 'desc' },
    select: { id: true, quantityAvailable: true, version: true },
  });
  let remaining = qty;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, row.quantityAvailable);
    if (take <= 0) continue;
    const updated = await tx.inventory.updateMany({
      where: { id: row.id, version: row.version, quantityAvailable: { gte: take } },
      data: {
        quantityAvailable: { decrement: take },
        quantityReserved: { increment: take },
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ConflictError('Stock changed, please try again');
    remaining -= take;
  }
  if (remaining > 0) throw new ConflictError('Insufficient stock');
}

/** Reverse a reservation on cancel (best-effort to the most-reserved warehouse row). */
async function releaseToWarehouse(tx: Tx, variantId: string, qty: number): Promise<void> {
  const row = await tx.inventory.findFirst({
    where: { variantId, warehouseId: { not: null } },
    orderBy: { quantityReserved: 'desc' },
    select: { id: true },
  });
  if (!row) return;
  await tx.inventory.update({
    where: { id: row.id },
    data: { quantityAvailable: { increment: qty }, quantityReserved: { decrement: qty } },
  });
}

async function loadOrder(id: string): Promise<OrderDTO> {
  const order = await checkoutRepository.findOrder(id);
  if (!order) throw new NotFoundError('Order not found');
  return toOrder(order);
}

export const checkoutService = {
  /** Place the active cart as a PENDING order, reserving stock. Idempotent per pending order. */
  async checkout(userId: string, addressId: string): Promise<OrderDTO> {
    const pending = await checkoutRepository.findPendingOrder(userId);
    if (pending) return toOrder(pending); // don't double-reserve on a retry

    const address = await checkoutRepository.findAddress(addressId, userId);
    if (!address) throw new NotFoundError('Address not found');

    const orderId = await prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findFirst({
        where: { userId, status: 'ACTIVE' },
        include: cartLineInclude,
      });
      if (!cart || cart.items.length === 0) throw new BadRequestError('Your cart is empty');

      for (const item of cart.items) {
        await reserveFromWarehouse(tx, item.variantId, item.quantity);
      }

      const totals = computeCartTotals(cart.items);
      const order = await tx.order.create({
        data: {
          userId,
          status: 'PENDING',
          source: 'ONLINE',
          subtotalPaise: totals.subtotalPaise,
          taxPaise: totals.taxPaise,
          shippingPaise: totals.shippingPaise,
          totalPaise: totals.totalPaise,
          shippingAddress: addressSnapshot(address) as Prisma.InputJsonObject,
          items: {
            create: cart.items.map((i) => ({
              variantId: i.variantId,
              quantity: i.quantity,
              unitPricePaise: i.variant.pricePaise,
            })),
          },
          payment: { create: { amountPaise: totals.totalPaise, provider: 'phonepe', status: 'CREATED' } },
        },
      });
      await tx.cart.update({ where: { id: cart.id }, data: { status: 'CONVERTED' } });
      return order.id;
    });

    return loadOrder(orderId);
  },

  async listOrders(userId: string, page: number, limit: number): Promise<Paginated<OrderDTO>> {
    const [rows, total] = await checkoutRepository.listOrders(userId, (page - 1) * limit, limit);
    return paginate(rows.map(toOrder), total, page, limit);
  },

  async getOrder(userId: string, id: string): Promise<OrderDTO> {
    const order = await checkoutRepository.findOrder(id);
    if (!order) throw new NotFoundError('Order not found');
    if (order.userId !== userId) throw new ForbiddenError();
    return toOrder(order);
  },

  async cancelOrder(userId: string, id: string): Promise<OrderDTO> {
    const order = await checkoutRepository.findOrder(id);
    if (!order) throw new NotFoundError('Order not found');
    if (order.userId !== userId) throw new ForbiddenError();
    if (order.status !== 'PENDING') throw new ConflictError('Only pending orders can be cancelled');

    await prisma.$transaction(async (tx) => {
      for (const item of order.items) await releaseToWarehouse(tx, item.variantId, item.quantity);
      await tx.order.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.payment.updateMany({ where: { orderId: id }, data: { status: 'FAILED' } });
    });
    return loadOrder(id);
  },

  /**
   * The single, idempotent capture path: PENDING → PAID (keeps the reservation for fulfilment).
   * PhonePe's verified webhook will call this in phase 4c; a DEV endpoint triggers it for now.
   */
  async markOrderPaid(id: string): Promise<OrderDTO> {
    const order = await checkoutRepository.findOrder(id);
    if (!order) throw new NotFoundError('Order not found');
    if (order.status === 'PENDING') {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id }, data: { status: 'PAID', placedAt: new Date() } });
        await tx.payment.updateMany({
          where: { orderId: id },
          data: { status: 'CAPTURED', capturedAt: new Date() },
        });
      });
    }
    return loadOrder(id);
  },
};
