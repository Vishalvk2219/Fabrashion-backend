import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { getOpenApiDocument } from '@/docs/openapi';

const app = createApp();

/** Paths the API actually exposes today. Update alongside the routers. */
const EXPECTED_OPERATIONS = [
  'get /health',
  'get /api/v1',
  'post /api/v1/auth/register',
  'post /api/v1/auth/login',
  'post /api/v1/auth/refresh',
  'post /api/v1/auth/logout',
  'get /api/v1/auth/me',
] as const;

describe('OpenAPI document', () => {
  const doc = getOpenApiDocument();

  it('documents every route, and only real routes', () => {
    const documented = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
      Object.keys(item as object).map((method) => `${method} ${path}`),
    );
    expect(documented.sort()).toEqual([...EXPECTED_OPERATIONS].sort());
  });

  it('gives every operation a unique operationId — clients name their methods from it', () => {
    const ids = Object.values(doc.paths ?? {}).flatMap((item) =>
      Object.values(item as Record<string, { operationId?: string }>).map((op) => op.operationId),
    );
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents the 401 on every authenticated operation', () => {
    const secured = Object.values(doc.paths ?? {}).flatMap((item) =>
      Object.values(
        item as Record<string, { security?: unknown[]; responses: Record<string, unknown> }>,
      ).filter((op) => op.security?.length),
    );
    expect(secured.length).toBeGreaterThan(0);
    for (const op of secured) expect(op.responses['401']).toBeDefined();
  });

  it('is served as JSON at /docs/openapi.json', async () => {
    const res = await request(app).get('/docs/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toBe('Fabrashion API');
  });

  it('is served as YAML at /docs/openapi.yaml', async () => {
    const res = await request(app).get('/docs/openapi.yaml').expect(200);
    expect(res.text).toContain('openapi: 3.0.3');
  });

  it('renders the reference UI at /docs', async () => {
    const res = await request(app).get('/docs').expect(200);
    expect(res.text).toContain('/docs/openapi.json');
  });

  it('matches the committed docs/openapi.json — run `npm run docs:generate`', async () => {
    const committed = await readFile(resolve(process.cwd(), 'docs/openapi.json'), 'utf8');
    expect(JSON.parse(committed)).toEqual(JSON.parse(JSON.stringify(doc)));
  });
});
