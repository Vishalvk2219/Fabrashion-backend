import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '@/app';
import { prisma } from '@/config/db';

const app = createApp();

/** Sign in an existing phone (or auto-created customer) via the OTP flow. */
async function signIn(phone: string): Promise<string> {
  const otp = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  const verify = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode });
  return verify.body.accessToken as string;
}

const STAFF_PHONE = '9000000002'; // seeded, store BLR01

describe('staff module', () => {
  let staffToken = '';
  let customerToken = '';
  const asStaff = () => ({ Authorization: `Bearer ${staffToken}` });

  beforeAll(async () => {
    staffToken = await signIn(STAFF_PHONE);
    customerToken = await signIn(`7${String(Date.now()).slice(-9)}`); // fresh CUSTOMER
  });

  it('rejects anonymous (401) and customer (403) callers', async () => {
    expect((await request(app).get('/api/v1/staff/summary')).status).toBe(401);
    const res = await request(app)
      .get('/api/v1/staff/summary')
      .set({ Authorization: `Bearer ${customerToken}` });
    expect(res.status).toBe(403);
  });

  it('returns the dashboard summary for the caller store', async () => {
    const res = await request(app).get('/api/v1/staff/summary').set(asStaff());
    expect(res.status).toBe(200);
    expect(res.body.store).toMatchObject({ code: 'BLR01', name: expect.any(String) });
    for (const key of ['toPack', 'ready', 'tryAtHome', 'lowStock', 'updatedToday', 'packedToday']) {
      expect(res.body[key]).toBeTypeOf('number');
    }
    expect(res.body.tryAtHome).toBe(0); // trials land in Phase 6
  });

  it('lists store inventory with buckets and supports q search', async () => {
    const res = await request(app).get('/api/v1/staff/inventory').set(asStaff());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    const row = res.body.data[0];
    expect(row).toMatchObject({
      variantId: expect.any(String),
      sku: expect.any(String),
      name: expect.any(String),
      floor: expect.any(Number),
      counter: expect.any(Number),
      reserved: expect.any(Number),
      version: expect.any(Number),
    });

    const filtered = await request(app)
      .get(`/api/v1/staff/inventory?q=${encodeURIComponent(row.sku)}`)
      .set(asStaff());
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].sku).toBe(row.sku);
  });

  it('applies bucket deltas once per eventId (idempotent replays)', async () => {
    const list = await request(app).get('/api/v1/staff/inventory?limit=100').set(asStaff());
    const row = list.body.data.find((r: { floor: number }) => r.floor >= 1);
    expect(row).toBeTruthy();

    const eventId = randomUUID();
    const move = { deltas: { floor: -1, counter: 1 }, eventId };
    const first = await request(app)
      .patch(`/api/v1/staff/inventory/${row.variantId}`)
      .set(asStaff())
      .send(move);
    expect(first.status).toBe(200);
    expect(first.body.floor).toBe(row.floor - 1);
    expect(first.body.counter).toBe(row.counter + 1);

    // Replaying the same event (offline-queue flush retry) must not re-apply.
    const replay = await request(app)
      .patch(`/api/v1/staff/inventory/${row.variantId}`)
      .set(asStaff())
      .send(move);
    expect(replay.status).toBe(200);
    expect(replay.body.floor).toBe(row.floor - 1);
    expect(replay.body.counter).toBe(row.counter + 1);
  });

  it('rejects a delta that would take a bucket below zero (409 INSUFFICIENT_STOCK)', async () => {
    const list = await request(app).get('/api/v1/staff/inventory?limit=100').set(asStaff());
    const row = list.body.data[0];
    const res = await request(app)
      .patch(`/api/v1/staff/inventory/${row.variantId}`)
      .set(asStaff())
      .send({ deltas: { floor: -99 }, eventId: randomUUID() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('404s an item that is not stocked at the store', async () => {
    const res = await request(app)
      .patch(`/api/v1/staff/inventory/${randomUUID()}`)
      .set(asStaff())
      .send({ deltas: { floor: 1 }, eventId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it('lists the fulfilment board; Try-at-Home is empty until Phase 6', async () => {
    const res = await request(app).get('/api/v1/staff/orders').set(asStaff());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const order of res.body.data) {
      expect(['TO_PACK', 'READY', 'HANDED_OVER']).toContain(order.stage);
      expect(order).toMatchObject({ customer: expect.any(String), totalPaise: expect.any(Number) });
    }
    const trials = await request(app).get('/api/v1/staff/orders?stage=TRY_AT_HOME').set(asStaff());
    expect(trials.body.data).toEqual([]);
  });

  it('advances an order PAID → FULFILLING → SHIPPED → DELIVERED, consuming the reservation', async () => {
    // Build a fresh PAID order so the test owns its data end to end.
    const products = await request(app).get('/api/v1/products');
    const variantId: string = products.body.data[0].variants[0].id;
    const asCustomer = { Authorization: `Bearer ${customerToken}` };
    const me = await request(app).get('/api/v1/auth/me').set(asCustomer);
    const address = await prisma.address.create({
      data: { userId: me.body.id, line1: '9 Pack St', city: 'Bengaluru', state: 'KA', pincode: '560001' },
    });
    await request(app).post('/api/v1/cart/items').set(asCustomer).send({ variantId, quantity: 1 });
    const order = await request(app)
      .post('/api/v1/checkout')
      .set(asCustomer)
      .send({ addressId: address.id });
    await request(app).post(`/api/v1/orders/${order.body.id}/confirm-dev`).set(asCustomer);

    const reservedBefore = await prisma.inventory.aggregate({
      where: { variantId, warehouseId: { not: null } },
      _sum: { quantityReserved: true },
    });

    const packed = await request(app)
      .post(`/api/v1/staff/orders/${order.body.id}/advance`)
      .set(asStaff());
    expect(packed.status).toBe(200);
    expect(packed.body).toMatchObject({ status: 'FULFILLING', stage: 'READY' });

    const reservedAfter = await prisma.inventory.aggregate({
      where: { variantId, warehouseId: { not: null } },
      _sum: { quantityReserved: true },
    });
    expect(reservedAfter._sum.quantityReserved).toBe(
      (reservedBefore._sum.quantityReserved ?? 0) - 1,
    );

    const shipped = await request(app)
      .post(`/api/v1/staff/orders/${order.body.id}/advance`)
      .set(asStaff());
    expect(shipped.body).toMatchObject({ status: 'SHIPPED', stage: 'HANDED_OVER' });
    const delivered = await request(app)
      .post(`/api/v1/staff/orders/${order.body.id}/advance`)
      .set(asStaff());
    expect(delivered.body).toMatchObject({ status: 'DELIVERED', stage: 'HANDED_OVER' });

    const beyond = await request(app)
      .post(`/api/v1/staff/orders/${order.body.id}/advance`)
      .set(asStaff());
    expect(beyond.status).toBe(409);
    expect(beyond.body.error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('404s advancing an unknown order', async () => {
    const res = await request(app)
      .post(`/api/v1/staff/orders/${randomUUID()}/advance`)
      .set(asStaff());
    expect(res.status).toBe(404);
  });
});
