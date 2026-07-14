import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';

describe('base app routes', () => {
  const app = createApp();

  it('GET /health returns 200 with per-service status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body.services).toHaveProperty('db');
    expect(res.body.services).toHaveProperty('redis');
  });

  it('GET /api/v1 returns service metadata', async () => {
    const res = await request(app).get('/api/v1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'fabrashion-backend', version: 'v1' });
  });

  it('unknown route returns the standard 404 error shape', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error).toHaveProperty('message');
  });

  it('echoes an x-request-id header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeDefined();
  });
});
