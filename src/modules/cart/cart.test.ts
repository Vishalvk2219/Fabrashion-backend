import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '@/app';

const app = createApp();

/** Sign in a brand-new customer via the OTP flow (isolates each run's cart/orders). */
async function signInFreshUser(): Promise<{ token: string; userId: string }> {
  const phone = `9${String(Date.now()).slice(-9)}`;
  const req = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  const verify = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: req.body.devCode });
  return { token: verify.body.accessToken, userId: verify.body.user.id };
}

describe('cart module', () => {
  let token = '';
  let variantId = '';
  let pricePaise = 0;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ({ token } = await signInFreshUser());
    const products = await request(app).get('/api/v1/products');
    const v = products.body.data[0].variants[0];
    variantId = v.id;
    pricePaise = v.pricePaise;
  });

  it('requires auth (401 without a token)', async () => {
    const res = await request(app).get('/api/v1/cart');
    expect(res.status).toBe(401);
  });

  it('starts empty', async () => {
    const res = await request(app).get('/api/v1/cart').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.lines).toEqual([]);
    expect(res.body.totals).toMatchObject({ count: 0, subtotalPaise: 0, totalPaise: 0 });
  });

  it('adds an item and computes server totals', async () => {
    const res = await request(app).post('/api/v1/cart/items').set(auth()).send({ variantId, quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0]).toMatchObject({ variantId, qty: 2, availableQty: expect.any(Number) });
    expect(res.body.totals.count).toBe(2);
    expect(res.body.totals.subtotalPaise).toBe(pricePaise * 2);
  });

  it('increments the same variant instead of duplicating the line', async () => {
    const res = await request(app).post('/api/v1/cart/items').set(auth()).send({ variantId, quantity: 1 });
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].qty).toBe(3);
  });

  it('rejects a quantity beyond available stock (409 CONFLICT)', async () => {
    const itemId = (await request(app).get('/api/v1/cart').set(auth())).body.lines[0].itemId;
    const res = await request(app).patch(`/api/v1/cart/items/${itemId}`).set(auth()).send({ quantity: 99 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('updates quantity and removes on 0', async () => {
    const itemId = (await request(app).get('/api/v1/cart').set(auth())).body.lines[0].itemId;
    const set2 = await request(app).patch(`/api/v1/cart/items/${itemId}`).set(auth()).send({ quantity: 2 });
    expect(set2.body.lines[0].qty).toBe(2);
    const removed = await request(app).patch(`/api/v1/cart/items/${itemId}`).set(auth()).send({ quantity: 0 });
    expect(removed.body.lines).toEqual([]);
  });
});
