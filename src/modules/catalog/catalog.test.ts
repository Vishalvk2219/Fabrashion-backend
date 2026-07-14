import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '@/app';

// Integration tests — require a running Postgres seeded via `npm run db:seed`
// (5 products; Women subtree = 2; Cotton Poplin Top is the cheapest at ₹1,299).
const app = createApp();

describe('catalog module', () => {
  let firstProductId = '';
  let womenCategoryId = '';

  beforeAll(async () => {
    const cats = await request(app).get('/api/v1/categories');
    womenCategoryId = cats.body.find((c: { name: string }) => c.name === 'Women')?.id ?? '';
    const list = await request(app).get('/api/v1/products');
    firstProductId = list.body.data[0]?.id ?? '';
  });

  it('lists categories (200) as a flat array with slugs', async () => {
    const res = await request(app).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(6);
    expect(res.body[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      slug: expect.any(String),
    });
  });

  it('lists products (200) paginated, with variants carrying availableQty', async () => {
    const res = await request(app).get('/api/v1/products');
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20 });
    expect(res.body.data.length).toBeGreaterThan(0);
    const p = res.body.data[0];
    expect(p).toMatchObject({ id: expect.any(String), name: expect.any(String), slug: expect.any(String) });
    expect(Array.isArray(p.images)).toBe(true);
    expect(p.variants[0]).toMatchObject({ sku: expect.any(String), availableQty: expect.any(Number) });
    expect(p.variants[0].availableQty).toBeGreaterThanOrEqual(0);
  });

  it('paginates with page/limit and reports totalPages', async () => {
    const res = await request(app).get('/api/v1/products?limit=2&page=1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.limit).toBe(2);
    expect(res.body.meta.totalPages).toBe(Math.ceil(res.body.meta.total / 2));
  });

  it('filters by category (parent matches its children) — Women subtree', async () => {
    const res = await request(app).get(`/api/v1/products?categoryId=${womenCategoryId}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
  });

  it('filters by price range', async () => {
    const cheapOnly = await request(app).get('/api/v1/products?maxPrice=200000'); // <= ₹2,000
    expect(cheapOnly.body.meta.total).toBe(1);
    const none = await request(app).get('/api/v1/products?minPrice=100000000');
    expect(none.body.meta.total).toBe(0);
    expect(none.body.data).toEqual([]);
  });

  it('sorts by price ascending and descending', async () => {
    type Row = { id: string; variants: { pricePaise: number }[] };
    const asc = (await request(app).get('/api/v1/products?sort=price_asc')).body.data as Row[];
    const desc = (await request(app).get('/api/v1/products?sort=price_desc')).body.data as Row[];
    const priceOf = (p: Row) => p.variants[0]!.pricePaise;
    expect(priceOf(asc[0]!)).toBeLessThanOrEqual(priceOf(asc[asc.length - 1]!));
    expect(priceOf(desc[0]!)).toBeGreaterThanOrEqual(priceOf(desc[desc.length - 1]!));
    expect(asc[0]!.id).not.toBe(desc[0]!.id);
  });

  it('searches by q (name/brand/description)', async () => {
    const res = await request(app).get('/api/v1/products?q=linen');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('rejects an invalid query (422 VALIDATION_ERROR)', async () => {
    const res = await request(app).get('/api/v1/products?limit=999'); // over max
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns a single product (200) and 404 for an unknown id', async () => {
    const ok = await request(app).get(`/api/v1/products/${firstProductId}`);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(firstProductId);
    expect(ok.body.variants.length).toBeGreaterThan(0);

    const missing = await request(app).get('/api/v1/products/00000000-0000-0000-0000-000000000000');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('returns availability with per-variant + per-store stock', async () => {
    const res = await request(app).get(`/api/v1/products/${firstProductId}/availability`);
    expect(res.status).toBe(200);
    expect(res.body.productId).toBe(firstProductId);
    expect(res.body.variants[0]).toMatchObject({
      variantId: expect.any(String),
      availableQty: expect.any(Number),
      inStock: expect.any(Boolean),
    });
    expect(Array.isArray(res.body.stores)).toBe(true);
  });
});
