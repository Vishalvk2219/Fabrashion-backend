import { env } from '@/config/env';
import { onlineAvailableQty } from '@/lib/inventory';
import { gstFromInclusive } from '@/lib/money';
import type { CartItemFull, CartWithItems } from './cart.repository';

export interface CartLineDTO {
  itemId: string;
  productId: string;
  variantId: string;
  name: string;
  brand: string | null;
  size: string;
  colorName: string;
  colorHex: string | null;
  imageUrl: string | null;
  pricePaise: number;
  mrpPaise: number;
  qty: number;
  /** Live online availability for this variant (for out-of-stock / max-qty UI). */
  availableQty: number;
  lineTotalPaise: number;
}

export interface CartTotalsDTO {
  count: number;
  subtotalPaise: number; // GST-inclusive sum of lines
  discountPaise: number; // MRP − subtotal
  taxPaise: number; // GST broken out of the inclusive subtotal
  shippingPaise: number;
  totalPaise: number;
}

export interface CartDTO {
  id: string;
  lines: CartLineDTO[];
  totals: CartTotalsDTO;
}

/** Minimal line shape needed to price a cart — satisfied by both the cart include and checkout's. */
export type PricedLine = {
  quantity: number;
  variant: { pricePaise: number; mrpPaise: number; product: { gstRatePct: number } };
};

/** Single source of truth for cart money — used by `GET /cart` and by checkout. */
export function computeCartTotals(items: PricedLine[]): CartTotalsDTO {
  let count = 0;
  let subtotalPaise = 0;
  let mrpPaise = 0;
  let taxPaise = 0;
  for (const item of items) {
    const lineTotal = item.variant.pricePaise * item.quantity;
    count += item.quantity;
    subtotalPaise += lineTotal;
    mrpPaise += item.variant.mrpPaise * item.quantity;
    taxPaise += gstFromInclusive(lineTotal, item.variant.product.gstRatePct);
  }
  const freeShipping = subtotalPaise === 0 || subtotalPaise >= env.FREE_SHIPPING_THRESHOLD_PAISE;
  const shippingPaise = freeShipping ? 0 : env.SHIPPING_FLAT_PAISE;
  return {
    count,
    subtotalPaise,
    discountPaise: Math.max(0, mrpPaise - subtotalPaise),
    taxPaise,
    shippingPaise,
    totalPaise: subtotalPaise + shippingPaise,
  };
}

function toCartLine(item: CartItemFull): CartLineDTO {
  const v = item.variant;
  return {
    itemId: item.id,
    productId: v.product.id,
    variantId: v.id,
    name: v.product.name,
    brand: v.product.brand,
    size: v.size,
    colorName: v.colorName,
    colorHex: v.colorHex,
    imageUrl: v.product.images[0]?.url ?? null,
    pricePaise: v.pricePaise,
    mrpPaise: v.mrpPaise,
    qty: item.quantity,
    availableQty: onlineAvailableQty(v.inventory),
    lineTotalPaise: v.pricePaise * item.quantity,
  };
}

export function toCart(cart: CartWithItems): CartDTO {
  return {
    id: cart.id,
    lines: cart.items.map(toCartLine),
    totals: computeCartTotals(cart.items),
  };
}
