import type { TrialStatus } from '@prisma/client';

import type { TrialWithRelations } from './trial.repository';

export interface TrialItemDTO {
  trialItemId: string;
  variantId: string;
  productId: string;
  name: string;
  brand: string | null;
  size: string;
  colorName: string;
  colorHex: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPricePaise: number;
  outcome: 'PENDING' | 'KEPT' | 'RETURNED';
}

export interface TrialDTO {
  id: string;
  status: TrialStatus;
  store: { id: string; name: string; code: string } | null;
  address: unknown;
  note: string | null;
  slotStart: string;
  slotEnd: string;
  authAmountPaise: number;
  /** True once the trial charge is captured (dev-confirm now, PhonePe in 4c). */
  paid: boolean;
  refundPaise: number;
  /** Keep/return deadline once delivered; undecided items auto-return after it. */
  trialEndsAt: string | null;
  /** Conversion order created for KEPT items on completion. */
  conversionOrderId: string | null;
  itemCount: number;
  items: TrialItemDTO[];
  createdAt: string;
}

export function toTrial(t: TrialWithRelations): TrialDTO {
  return {
    id: t.id,
    status: t.status,
    store: t.store,
    address: t.address,
    note: t.note,
    slotStart: t.slotStart.toISOString(),
    slotEnd: t.slotEnd.toISOString(),
    authAmountPaise: t.authAmountPaise,
    paid: t.paymentCapturedAt !== null,
    refundPaise: t.refundPaise,
    trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
    conversionOrderId: t.orders[0]?.id ?? null,
    itemCount: t.items.reduce((n, i) => n + i.quantity, 0),
    items: t.items.map((i) => ({
      trialItemId: i.id,
      variantId: i.variant.id,
      productId: i.variant.product.id,
      name: i.variant.product.name,
      brand: i.variant.product.brand,
      size: i.variant.size,
      colorName: i.variant.colorName,
      colorHex: i.variant.colorHex,
      imageUrl: i.variant.product.images[0]?.url ?? null,
      quantity: i.quantity,
      unitPricePaise: i.unitPricePaise,
      outcome: i.outcome,
    })),
    createdAt: t.createdAt.toISOString(),
  };
}

// ── Eligibility ──
export interface TrialSlotWindowDTO {
  slotStart: string;
  slotEnd: string;
  available: boolean;
}

export interface EligibilityDTO {
  addressServiceable: boolean;
  store: { id: string; name: string; code: string } | null;
  items: {
    variantId: string;
    eligible: boolean;
    reason: string | null;
    name: string;
    size: string;
    colorName: string;
    pricePaise: number;
  }[];
  slots: { date: string; windows: TrialSlotWindowDTO[] }[];
  limits: { maxItems: number; maxValuePaise: number };
}
