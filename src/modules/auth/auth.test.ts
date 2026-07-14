import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '@/app';

// Integration tests — require a running Postgres (docker:up + migrated schema).
const app = createApp();

const unique = Date.now();
const newUser = {
  fullName: 'Test User',
  email: `test-${unique}@example.com`,
  phone: `9${String(unique).slice(-9)}`, // 10 digits starting with 9
  password: 'Password123!',
};

describe('auth module', () => {
  let accessToken = '';
  let refreshToken = '';

  it('registers a new user (201) with a user + tokens', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(newUser);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: newUser.email, role: 'CUSTOMER' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('rejects duplicate registration (409 CONFLICT)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(newUser);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects an invalid register body (422 VALIDATION_ERROR)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'nope' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with correct credentials (200)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: newUser.email, password: newUser.password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('rejects a wrong password with a generic 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: newUser.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns the current user for GET /me with a valid token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: newUser.email, role: 'CUSTOMER' });
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
