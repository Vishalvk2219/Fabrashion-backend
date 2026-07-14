import type { Category } from '@prisma/client';

import { onlineAvailableQty } from '@/lib/inventory';
import { type Paginated, paginate } from '@/lib/pagination';
import type { ProductWithAvailability, ProductWithRelations } from './catalog.repository';

export type { Paginated };
export { paginate };

// ── Public DTOs (match fabrashion-mobile/src/features/catalog/schema.ts) ──
export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

export interface ProductImageDTO {
  id: string;
  url: string;
  altText: string | null;
  position: number;
}

export interface ProductVariantDTO {
  id: string;
  sku: string;
  size: string;
  colorName: string;
  colorHex: string | null;
  pricePaise: number;
  mrpPaise: number;
  /** Sellable now, summed across ONLINE locations only. */
  availableQty: number;
}

export interface ProductDTO {
  id: string;
  name: string;
  slug: string;
  description: string;
  brand: string | null;
  department: ProductWithRelations['department'];
  trialEligible: boolean;
  images: ProductImageDTO[];
  variants: ProductVariantDTO[];
}

export function toCategory(c: Category): CategoryDTO {
  return { id: c.id, name: c.name, slug: c.slug, parentId: c.parentId };
}

export function toProduct(p: ProductWithRelations): ProductDTO {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    brand: p.brand,
    department: p.department,
    trialEligible: p.trialEligible,
    images: p.images.map((img) => ({
      id: img.id,
      url: img.url,
      altText: img.altText,
      position: img.position,
    })),
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      size: v.size,
      colorName: v.colorName,
      colorHex: v.colorHex,
      pricePaise: v.pricePaise,
      mrpPaise: v.mrpPaise,
      availableQty: onlineAvailableQty(v.inventory),
    })),
  };
}

// ── Availability endpoint ──
export interface AvailabilityDTO {
  productId: string;
  variants: { variantId: string; availableQty: number; inStock: boolean }[];
  stores: { storeId: string; name: string; city: string; inStock: boolean }[];
}

export function toAvailability(p: ProductWithAvailability): AvailabilityDTO {
  const variants = p.variants.map((v) => {
    const availableQty = onlineAvailableQty(v.inventory);
    return { variantId: v.id, availableQty, inStock: availableQty > 0 };
  });

  // Sync-enabled stores that carry any variant of this product, with whether they have stock now.
  const byStore = new Map<string, { storeId: string; name: string; city: string; inStock: boolean }>();
  for (const variant of p.variants) {
    for (const row of variant.inventory) {
      const store = row.store;
      if (!store || !store.syncEnabled) continue;
      const existing = byStore.get(store.id);
      const inStock = row.quantityAvailable > 0;
      if (existing) existing.inStock ||= inStock;
      else byStore.set(store.id, { storeId: store.id, name: store.name, city: store.city, inStock });
    }
  }

  return { productId: p.id, variants, stores: [...byStore.values()] };
}
