import type { Prisma } from '@prisma/client';

import { prisma } from '@/config/db';

/** Everything a cart line needs: variant + product snapshot (name/brand/gst/image) and the
 * inventory rows to fold into online availability. */
const cartInclude = {
  items: {
    orderBy: { id: 'asc' },
    include: {
      variant: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              brand: true,
              gstRatePct: true,
              images: { take: 1, orderBy: { position: 'asc' }, select: { url: true } },
            },
          },
          inventory: {
            select: { quantityAvailable: true, warehouseId: true, store: { select: { syncEnabled: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
export type CartItemFull = CartWithItems['items'][number];

const variantStockSelect = {
  id: true,
  inventory: {
    select: { quantityAvailable: true, warehouseId: true, store: { select: { syncEnabled: true } } },
  },
} satisfies Prisma.ProductVariantSelect;
export type VariantStock = Prisma.ProductVariantGetPayload<{ select: typeof variantStockSelect }>;

const itemWithOwner = {
  cart: { select: { userId: true } },
  variant: {
    select: {
      inventory: {
        select: { quantityAvailable: true, warehouseId: true, store: { select: { syncEnabled: true } } },
      },
    },
  },
} satisfies Prisma.CartItemInclude;
export type CartItemWithOwner = Prisma.CartItemGetPayload<{ include: typeof itemWithOwner }>;

export const cartRepository = {
  findActiveCart(userId: string): Promise<CartWithItems | null> {
    return prisma.cart.findFirst({ where: { userId, status: 'ACTIVE' }, include: cartInclude });
  },

  async getOrCreateActiveCart(userId: string): Promise<CartWithItems> {
    const existing = await this.findActiveCart(userId);
    if (existing) return existing;
    const created = await prisma.cart.create({ data: { userId } });
    // Re-read with the include so the shape is uniform.
    return prisma.cart.findUniqueOrThrow({ where: { id: created.id }, include: cartInclude });
  },

  findVariantStock(variantId: string): Promise<VariantStock | null> {
    return prisma.productVariant.findUnique({ where: { id: variantId }, select: variantStockSelect });
  },

  findItem(itemId: string): Promise<CartItemWithOwner | null> {
    return prisma.cartItem.findUnique({ where: { id: itemId }, include: itemWithOwner });
  },

  upsertItem(cartId: string, variantId: string, quantity: number): Promise<unknown> {
    return prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId } },
      create: { cartId, variantId, quantity },
      update: { quantity },
    });
  },

  updateItemQty(itemId: string, quantity: number): Promise<unknown> {
    return prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
  },

  deleteItem(itemId: string): Promise<unknown> {
    return prisma.cartItem.delete({ where: { id: itemId } });
  },
};
