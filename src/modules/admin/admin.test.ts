import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '@/app';
import { prisma } from '@/config/db';

const app = createApp();

async function signIn(phone: string): Promise<string> {
  const otp = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  const verify = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode });
  return verify.body.accessToken as string;
}

/** Unique 10-digit test phone (valid Indian format, starts with 8). */
const freshPhone = () => `8${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-9)}`;

describe('admin module', () => {
  let adminToken = '';
  let staffToken = '';
  const asAdmin = () => ({ Authorization: `Bearer ${adminToken}` });

  /**
   * Products this suite creates, torn down below. The catalog suite asserts on
   * exact product counts against the seed baseline, so anything left behind here
   * breaks it — and left the whole suite unable to pass twice in a row.
   */
  const createdProductIds: string[] = [];

  beforeAll(async () => {
    adminToken = await signIn('9000000001');
    // A dedicated staff account for the 403 gate test — the seeded staff phone is
    // exercised by the staff suite, and parallel OTP flows on one phone would race.
    const phone = freshPhone();
    await request(app)
      .post('/api/v1/admin/staff')
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ fullName: 'Gate Test Staff', phone, role: 'STAFF' });
    staffToken = await signIn(phone);
  });

  it('rejects anonymous (401) and staff (403) callers', async () => {
    expect((await request(app).get('/api/v1/admin/overview')).status).toBe(401);
    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set({ Authorization: `Bearer ${staffToken}` });
    expect(res.status).toBe(403);
  });

  it('computes the overview from realized orders', async () => {
    const res = await request(app).get('/api/v1/admin/overview').set(asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.revenueTodayPaise).toBeGreaterThan(0); // seed places 2 PAID orders today
    expect(res.body.ordersToday).toBeGreaterThanOrEqual(2);
    expect(res.body.avgOrderPaise).toBeGreaterThan(0);
    expect(res.body.activeCustomers).toBeGreaterThanOrEqual(2);
    expect(res.body.deltas).toMatchObject({});
    expect(res.body.revenue7d).toHaveLength(7);
    const total7d = res.body.revenue7d.reduce(
      (s: number, d: { revenuePaise: number }) => s + d.revenuePaise,
      0,
    );
    expect(total7d).toBeGreaterThan(0);
    // Channel split: online first (real revenue), physical stores honestly 0 until POS sync.
    expect(res.body.storePerf[0]).toMatchObject({ storeId: null, name: 'Online Store' });
    expect(res.body.storePerf[0].revenuePaise).toBe(total7d);
    expect(res.body.storePerf.length).toBeGreaterThanOrEqual(3);
  });

  it('lists the team with derived Active/Invited status', async () => {
    const res = await request(app).get('/api/v1/admin/staff?limit=50').set(asAdmin());
    expect(res.status).toBe(200);
    const byPhone = (p: string) => res.body.data.find((u: { phone: string }) => u.phone === p);
    expect(byPhone('+919000000002')).toMatchObject({
      role: 'STAFF',
      status: 'ACTIVE',
      store: { code: 'BLR01' },
    });
    expect(byPhone('+919000000004')).toMatchObject({ role: 'STAFF', status: 'INVITED' });
    expect(res.body.data.some((u: { role: string }) => u.role === 'CUSTOMER')).toBe(false);
  });

  it('creates a staff account that can sign in via OTP and turns Active', async () => {
    const phone = freshPhone();
    const staffList = await request(app).get('/api/v1/admin/staff?limit=50').set(asAdmin());
    const storeId = staffList.body.data.find((u: { store: unknown }) => u.store)?.store.id;

    const created = await request(app)
      .post('/api/v1/admin/staff')
      .set(asAdmin())
      .send({
        fullName: 'Test Staffer',
        phone,
        role: 'STAFF',
        storeId,
        permissions: { inventory: true, orders: false },
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'INVITED', role: 'STAFF' });

    // The "invite" is the account itself: the same phone-OTP flow signs them in as STAFF…
    const otp = await request(app).post('/api/v1/auth/otp/request').send({ phone });
    const verify = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: otp.body.devCode });
    expect(verify.body.user.role).toBe('STAFF');
    // …and their store-scoped staff APIs work immediately.
    const summary = await request(app)
      .get('/api/v1/staff/summary')
      .set({ Authorization: `Bearer ${verify.body.accessToken}` });
    expect(summary.status).toBe(200);

    const after = await request(app).get('/api/v1/admin/staff?limit=50').set(asAdmin());
    const me = after.body.data.find((u: { phone: string }) => u.phone === `+91${phone}`);
    expect(me.status).toBe('ACTIVE'); // first sign-in verified the phone
  });

  it('409s a duplicate phone', async () => {
    const res = await request(app).post('/api/v1/admin/staff').set(asAdmin()).send({
      fullName: 'Duplicate Phone',
      phone: '9000000002',
      role: 'STAFF',
    });
    expect(res.status).toBe(409);
  });

  it('lists the catalog with cross-location stock and q search', async () => {
    const res = await request(app).get('/api/v1/admin/catalog').set(asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(5);
    expect(res.body.data[0]).toMatchObject({
      name: expect.any(String),
      minPricePaise: expect.any(Number),
      totalStock: expect.any(Number),
      isActive: true,
    });
    const filtered = await request(app).get('/api/v1/admin/catalog?q=Oxford').set(asAdmin());
    expect(filtered.body.data.some((p: { name: string }) => p.name.includes('Oxford'))).toBe(true);
  });

  it('creates a product with variants, opening stock, and correct min/max prices', async () => {
    const name = `Test Trench Coat ${Date.now()}`;
    const categories = await request(app).get('/api/v1/categories');
    const categoryId = categories.body.find(
      (c: { parentId: string | null }) => c.parentId !== null,
    ).id;

    const res = await request(app)
      .post('/api/v1/admin/products')
      .set(asAdmin())
      .send({
        name,
        description: 'Water-resistant cotton gabardine trench.',
        categoryId,
        department: 'WOMEN',
        brand: 'Maison',
        gstRatePct: 12,
        trialEligible: true,
        imageUrl: 'https://picsum.photos/seed/trench/800/1000',
        initialWarehouseQty: 6,
        variants: [
          {
            size: 'S',
            colorName: 'Sand',
            colorHex: '#D6C6A8',
            pricePaise: 799900,
            mrpPaise: 999900,
          },
          {
            size: 'M',
            colorName: 'Sand',
            colorHex: '#D6C6A8',
            pricePaise: 849900,
            mrpPaise: 999900,
          },
        ],
      });
    expect(res.status).toBe(201);
    createdProductIds.push(res.body.id);
    expect(res.body).toMatchObject({
      name,
      minPricePaise: 799900, // denormalized pair maintained by the write path
      maxPricePaise: 849900,
      totalStock: 12,
      isActive: true,
    });

    // Visible in the PUBLIC catalog immediately (same product the shop reads).
    const detail = await request(app).get(`/api/v1/products/${res.body.slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.name).toBe(name);
  });

  it('suffixes the slug when the name collides', async () => {
    const name = `Slug Collision Tee ${Date.now()}`;
    const categories = await request(app).get('/api/v1/categories');
    const categoryId = categories.body[0].id;
    const payload = {
      name,
      description: 'First of two identically-named products.',
      categoryId,
      department: 'UNISEX',
      initialWarehouseQty: 5,
      variants: [{ size: 'M', colorName: 'White', pricePaise: 99900, mrpPaise: 129900 }],
    };
    const first = await request(app).post('/api/v1/admin/products').set(asAdmin()).send(payload);
    const second = await request(app).post('/api/v1/admin/products').set(asAdmin()).send(payload);
    createdProductIds.push(first.body.id, second.body.id);
    expect(second.status).toBe(201);
    expect(second.body.slug).toBe(`${first.body.slug}-2`);
  });

  it('422s duplicate size+color variants', async () => {
    const categories = await request(app).get('/api/v1/categories');
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set(asAdmin())
      .send({
        name: 'Broken Variants Product',
        description: 'Duplicate variant rows.',
        categoryId: categories.body[0].id,
        department: 'MEN',
        variants: [
          { size: 'M', colorName: 'Black', pricePaise: 100000, mrpPaise: 100000 },
          { size: 'M', colorName: 'black', pricePaise: 110000, mrpPaise: 120000 },
        ],
      });
    expect(res.status).toBe(422);
  });

  it('lists orders with design statuses and filters (never PENDING)', async () => {
    const res = await request(app).get('/api/v1/admin/orders?limit=50').set(asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(5);
    for (const order of res.body.data) {
      expect(['NEW', 'PACKED', 'DELIVERED', 'CANCELLED']).toContain(order.status);
      expect(order.rawStatus).not.toBe('PENDING');
      expect(order).toMatchObject({ customer: expect.any(String), totalPaise: expect.any(Number) });
    }
    const cancelled = await request(app)
      .get('/api/v1/admin/orders?status=CANCELLED')
      .set(asAdmin());
    expect(cancelled.body.data.length).toBeGreaterThanOrEqual(1);
    for (const order of cancelled.body.data) expect(order.status).toBe('CANCELLED');
  });

  // Variants, images, and inventory go with the product (FK cascade).
  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  });
});
