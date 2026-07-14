import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '@/app';

const app = createApp();

async function signInFreshUser(): Promise<string> {
  const phone = `9${String(Date.now()).slice(-9)}`;
  const req = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  const verify = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: req.body.devCode });
  return verify.body.accessToken;
}

const sample = {
  label: 'HOME',
  recipientName: 'Riya Kapoor',
  recipientPhone: '+919812345678',
  line1: '12 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

describe('address module', () => {
  let token = '';
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    token = await signInFreshUser();
  });

  it('requires auth (401)', async () => {
    expect((await request(app).get('/api/v1/addresses')).status).toBe(401);
  });

  it('creates the first address as default', async () => {
    const res = await request(app).post('/api/v1/addresses').set(auth()).send(sample);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ recipientName: 'Riya Kapoor', city: 'Bengaluru', isDefault: true });
  });

  it('rejects an invalid pincode (422)', async () => {
    const res = await request(app).post('/api/v1/addresses').set(auth()).send({ ...sample, pincode: '123' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('a second default demotes the first', async () => {
    const second = await request(app)
      .post('/api/v1/addresses')
      .set(auth())
      .send({ ...sample, label: 'WORK', line1: '7 Prism Tower', isDefault: true });
    expect(second.body.isDefault).toBe(true);

    const list = (await request(app).get('/api/v1/addresses').set(auth())).body;
    expect(list).toHaveLength(2);
    expect(list.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
    expect(list[0].id).toBe(second.body.id); // default sorts first
  });

  it('updates an address', async () => {
    const list = (await request(app).get('/api/v1/addresses').set(auth())).body;
    const id = list[1].id;
    const res = await request(app).patch(`/api/v1/addresses/${id}`).set(auth()).send({ city: 'Mysuru' });
    expect(res.body.city).toBe('Mysuru');
  });

  it('deleting the default promotes another', async () => {
    const list = (await request(app).get('/api/v1/addresses').set(auth())).body;
    const defaultId = list.find((a: { isDefault: boolean }) => a.isDefault).id;
    const res = await request(app).delete(`/api/v1/addresses/${defaultId}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.addresses).toHaveLength(1);
    expect(res.body.addresses[0].isDefault).toBe(true);
  });

  it("blocks another user's address (403)", async () => {
    const mine = (await request(app).get('/api/v1/addresses').set(auth())).body[0].id;
    const otherToken = await signInFreshUser();
    const res = await request(app)
      .patch(`/api/v1/addresses/${mine}`)
      .set({ Authorization: `Bearer ${otherToken}` })
      .send({ city: 'Hack' });
    expect(res.status).toBe(403);
  });
});
