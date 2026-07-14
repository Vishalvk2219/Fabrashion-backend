import type { Address } from '@prisma/client';

import type { OrderWithRelations } from './checkout.repository';

export interface OrderItemDTO {
  productId: string;
  variantId: string;
  name: string;
  brand: string | null;
  size: string;
  colorName: string;
  colorHex: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export interface OrderPaymentDTO {
  status: string;
  provider: string;
  amountPaise: number;
  method: string | null;
}

export interface OrderDTO {
  id: string;
  status: OrderWithRelations['status'];
  source: OrderWithRelations['source'];
  subtotalPaise: number;
  taxPaise: number;
  shippingPaise: number;
  totalPaise: number;
  itemCount: number;
  shippingAddress: unknown;
  placedAt: string | null;
  createdAt: string;
  items: OrderItemDTO[];
  payment: OrderPaymentDTO | null;
}

/** Immutable snapshot of the shipping address, stored on the order at purchase time. */
export function addressSnapshot(a: Address): Record<string, unknown> {
  return {
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    geoLat: a.geoLat,
    geoLng: a.geoLng,
  };
}

export function toOrder(o: OrderWithRelations): OrderDTO {
  return {
    id: o.id,
    status: o.status,
    source: o.source,
    subtotalPaise: o.subtotalPaise,
    taxPaise: o.taxPaise,
    shippingPaise: o.shippingPaise,
    totalPaise: o.totalPaise,
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    shippingAddress: o.shippingAddress,
    placedAt: o.placedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((i) => ({
      productId: i.variant.product.id,
      variantId: i.variant.id,
      name: i.variant.product.name,
      brand: i.variant.product.brand,
      size: i.variant.size,
      colorName: i.variant.colorName,
      colorHex: i.variant.colorHex,
      imageUrl: i.variant.product.images[0]?.url ?? null,
      quantity: i.quantity,
      unitPricePaise: i.unitPricePaise,
      lineTotalPaise: i.unitPricePaise * i.quantity,
    })),
    payment: o.payment
      ? {
          status: o.payment.status,
          provider: o.payment.provider,
          amountPaise: o.payment.amountPaise,
          method: o.payment.method,
        }
      : null,
  };
}
