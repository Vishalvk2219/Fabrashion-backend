import type { Category, Prisma } from '@prisma/client';

import { prisma } from '@/config/db';

/** Product shape for list + detail: ordered images and variants with just the inventory fields
 * needed to compute online availability (never the raw per-location stock). */
const productInclude = {
  images: { orderBy: { position: 'asc' } },
  variants: {
    orderBy: { pricePaise: 'asc' },
    include: {
      inventory: {
        select: { quantityAvailable: true, warehouseId: true, store: { select: { syncEnabled: true } } },
      },
    },
  },
} satisfies Prisma.ProductInclude;

/** Richer include for the availability endpoint: which sync-enabled stores carry each variant. */
const availabilityInclude = {
  variants: {
    orderBy: { pricePaise: 'asc' },
    include: {
      inventory: {
        select: {
          quantityAvailable: true,
          warehouseId: true,
          store: { select: { id: true, name: true, city: true, syncEnabled: true } },
        },
      },
    },
  },
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
export type ProductWithAvailability = Prisma.ProductGetPayload<{ include: typeof availabilityInclude }>;

const activeById = (idOrSlug: string): Prisma.ProductWhereInput => ({
  isActive: true,
  OR: [{ id: idOrSlug }, { slug: idOrSlug }],
});

/** Only layer that touches Prisma for catalog. */
export const catalogRepository = {
  findCategories(): Promise<Category[]> {
    return prisma.category.findMany({ orderBy: { name: 'asc' } });
  },

  findCategoryTree(id: string): Promise<{ id: string; children: { id: string }[] } | null> {
    return prisma.category.findUnique({
      where: { id },
      select: { id: true, children: { select: { id: true } } },
    });
  },

  /** One round-trip for the page + its total, so `meta` is consistent with the filter. */
  listProducts(args: {
    where: Prisma.ProductWhereInput;
    orderBy: Prisma.ProductOrderByWithRelationInput;
    skip: number;
    take: number;
  }): Promise<[ProductWithRelations[], number]> {
    const { where, orderBy, skip, take } = args;
    return prisma.$transaction([
      prisma.product.findMany({ where, orderBy, skip, take, include: productInclude }),
      prisma.product.count({ where }),
    ]);
  },

  findProduct(idOrSlug: string): Promise<ProductWithRelations | null> {
    return prisma.product.findFirst({ where: activeById(idOrSlug), include: productInclude });
  },

  findProductAvailability(idOrSlug: string): Promise<ProductWithAvailability | null> {
    return prisma.product.findFirst({ where: activeById(idOrSlug), include: availabilityInclude });
  },
};
