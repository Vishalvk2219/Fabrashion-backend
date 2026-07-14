import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '@/app';

// Integration tests — require a running Postgres (docker:up + migrated schema).
// OTP_EXPOSE_CODE is on outside production, so the request response carries `devCode`.
const app = createApp();

const phone = `9${String(Date.now()).slice(-9)}`; // 10 digits starting with 9

describe('auth module (phone-OTP)', () => {
  let accessToken = '';
  let refreshToken = '';
  let devCode = '';

  it('requests an OTP (200) and returns a dev code', async () => {
    const res = await request(app).post('/api/v1/auth/otp/request').send({ phone });
    expect(res.status).toBe(200);
    expect(res.body.expiresInSec).toBeGreaterThan(0);
    expect(res.body.devCode).toMatch(/^\d{4}$/);
    devCode = res.body.devCode;
  });

  it('rejects an invalid phone (422 VALIDATION_ERROR)', async () => {
    const res = await request(app).post('/api/v1/auth/otp/request').send({ phone: '12345' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a wrong code (401 UNAUTHORIZED)', async () => {
    const wrong = devCode === '0000' ? '1111' : '0000';
    const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone, code: wrong });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('verifies the OTP (200), creating a CUSTOMER account with tokens', async () => {
    const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone, code: devCode });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ phone: `+91${phone}`, role: 'CUSTOMER' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('rejects reusing a consumed code (400 BAD_REQUEST)', async () => {
    const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone, code: devCode });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns the current user for GET /me with a valid token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ phone: `+91${phone}`, role: 'CUSTOMER' });
  });

  it('rejects GET /me without a token (401)', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rotates the refresh token and rejects reuse of the old one', async () => {
    const rotated = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).toBeTruthy();
    expect(rotated.body.refreshToken).not.toBe(refreshToken);

    // The original (now rotated/revoked) token must be rejected.
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(reuse.status).toBe(401);
  });
});
