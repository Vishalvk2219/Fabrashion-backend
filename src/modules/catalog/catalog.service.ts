import type { Prisma } from '@prisma/client';

import { NotFoundError } from '@/lib/errors';
import {
  type AvailabilityDTO,
  type CategoryDTO,
  type Paginated,
  type ProductDTO,
  paginate,
  toAvailability,
  toCategory,
  toProduct,
} from './catalog.mapper';
import { catalogRepository } from './catalog.repository';
import type { ProductListQuery, ProductSort } from './catalog.schema';

const ORDER_BY: Record<ProductSort, Prisma.ProductOrderByWithRelationInput> = {
  // Real popularity needs orders/reviews (a later phase); newest-first is the stand-in.
  popular: { createdAt: 'desc' },
  newest: { createdAt: 'desc' },
  price_asc: { minPricePaise: 'asc' },
  price_desc: { minPricePaise: 'desc' },
};

/** Translate the validated query into a Prisma `where` (active products only). */
async function buildWhere(query: ProductListQuery): Promise<Prisma.ProductWhereInput> {
  const where: Prisma.ProductWhereInput = { isActive: true };

  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { brand: { contains: query.q, mode: 'insensitive' } },
      { description: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  if (query.categoryId) {
    // Two-level tree: a parent category also matches its children's products.
    const tree = await catalogRepository.findCategoryTree(query.categoryId);
    where.categoryId = { in: tree ? [tree.id, ...tree.children.map((c) => c.id)] : [query.categoryId] };
  }

  // A product's [min,max] price range must overlap the requested [minPrice,maxPrice].
  if (query.minPrice != null) where.maxPricePaise = { gte: query.minPrice };
  if (query.maxPrice != null) where.minPricePaise = { lte: query.maxPrice };

  return where;
}

export const catalogService = {
  async getCategories(): Promise<CategoryDTO[]> {
    const categories = await catalogRepository.findCategories();
    return categories.map(toCategory);
  },

  async listProducts(query: ProductListQuery): Promise<Paginated<ProductDTO>> {
    const where = await buildWhere(query);
    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await catalogRepository.listProducts({
      where,
      orderBy: ORDER_BY[query.sort],
      skip,
      take: query.limit,
    });
    return paginate(rows.map(toProduct), total, query.page, query.limit);
  },

  async getProduct(idOrSlug: string): Promise<ProductDTO> {
    const product = await catalogRepository.findProduct(idOrSlug);
    if (!product) throw new NotFoundError('Product not found');
    return toProduct(product);
  },

  async getAvailability(idOrSlug: string): Promise<AvailabilityDTO> {
    const product = await catalogRepository.findProductAvailability(idOrSlug);
    if (!product) throw new NotFoundError('Product not found');
    return toAvailability(product);
  },
};
