import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '@/app';
import { prisma } from '@/config/db';

const app = createApp();

async function signInFreshUser(): Promise<{ token: string; userId: string }> {
  const phone = `9${String(Date.now()).slice(-9)}`;
  const req = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  const verify = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: req.body.devCode });
  return { token: verify.body.accessToken, userId: verify.body.user.id };
}

describe('checkout + orders module', () => {
  let token = '';
  let addressId = '';
  let variantId = '';
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const addToCart = (quantity = 1) =>
    request(app).post('/api/v1/cart/items').set(auth()).send({ variantId, quantity });

  beforeAll(async () => {
    const user = await signInFreshUser();
    token = user.token;
    const address = await prisma.address.create({
      data: { userId: user.userId, line1: '1 Test St', city: 'Bengaluru', state: 'KA', pincode: '560001' },
    });
    addressId = address.id;
    const products = await request(app).get('/api/v1/products');
    variantId = products.body.data[0].variants[0].id;
  });

  it('rejects checkout with an empty cart (400)', async () => {
    const res = await request(app).post('/api/v1/checkout').set(auth()).send({ addressId });
    expect(res.status).toBe(400);
  });

  it('places an order from the cart, reserving stock', async () => {
    await addToCart(1);
    const cart = (await request(app).get('/api/v1/cart').set(auth())).body;
    const res = await request(app).post('/api/v1/checkout').set(auth()).send({ addressId });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.totalPaise).toBe(cart.totals.totalPaise);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.payment).toMatchObject({ status: 'CREATED', amountPaise: cart.totals.totalPaise });
    // Cart is converted → a fresh empty cart now.
    const after = await request(app).get('/api/v1/cart').set(auth());
    expect(after.body.lines).toEqual([]);
  });

  it('is idempotent — a second checkout returns the same pending order', async () => {
    const first = await request(app).post('/api/v1/checkout').set(auth()).send({ addressId });
    const second = await request(app).post('/api/v1/checkout').set(auth()).send({ addressId });
    expect(second.body.id).toBe(first.body.id);
  });

  it('confirms payment (dev) → PAID, and lists/reads the order', async () => {
    const orders = (await request(app).get('/api/v1/orders').set(auth())).body;
    const orderId = orders.data[0].id;

    const paid = await request(app).post(`/api/v1/orders/${orderId}/confirm-dev`).set(auth());
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.placedAt).toBeTruthy();

    const detail = await request(app).get(`/api/v1/orders/${orderId}`).set(auth());
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: orderId, status: 'PAID', payment: { status: 'CAPTURED' } });
  });

  it('cannot cancel a paid order (409), but can cancel a fresh pending one', async () => {
    const paidId = (await request(app).get('/api/v1/orders').set(auth())).body.data[0].id;
    const noCancel = await request(app).post(`/api/v1/orders/${paidId}/cancel`).set(auth());
    expect(noCancel.status).toBe(409);

    await addToCart(1);
    const fresh = await request(app).post('/api/v1/checkout').set(auth()).send({ addressId });
    const cancelled = await request(app).post(`/api/v1/orders/${fresh.body.id}/cancel`).set(auth());
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
  });

  it("blocks reading another user's order (403)", async () => {
    const orderId = (await request(app).get('/api/v1/orders').set(auth())).body.data[0].id;
    const other = await signInFreshUser();
    const res = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set({ Authorization: `Bearer ${other.token}` });
    expect(res.status).toBe(403);
  });
});
