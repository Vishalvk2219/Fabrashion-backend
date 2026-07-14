import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { getOpenApiDocument } from '@/docs/openapi';
import { addressRouter } from '@/modules/address/address.route';
import { adminRouter } from '@/modules/admin/admin.route';
import { authRouter } from '@/modules/auth/auth.route';
import { cartRouter } from '@/modules/cart/cart.route';
import { categoriesRouter, productsRouter } from '@/modules/catalog/catalog.route';
import { checkoutRouter, ordersRouter } from '@/modules/checkout/checkout.route';
import { staffRouter } from '@/modules/staff/staff.route';
import { trialsRouter } from '@/modules/trial/trial.route';
import { apiRouter } from '@/routes';
import { healthRouter } from '@/routes/health.route';

const app = createApp();

/**
 * Where each router is mounted — mirrors `app.ts` + `routes/index.ts`.
 *
 * Only the *mounts* are listed. The routes inside each router are discovered by
 * walking it, so a new endpoint is picked up automatically and shows up as an
 * undocumented-route failure until it has an `.openapi.ts` entry. (Express 5
 * keeps mount prefixes in a closure, so they cannot be read back off the app —
 * hence this table.)
 *
 * `/docs/*` is deliberately absent: it serves the spec, it is not part of it.
 */
const MOUNTS: [prefix: string, router: Router][] = [
  ['', healthRouter],
  ['/api/v1', apiRouter], // its own `GET /` only; the sub-routers below are walked directly
  ['/api/v1/auth', authRouter],
  ['/api/v1/categories', categoriesRouter],
  ['/api/v1/products', productsRouter],
  ['/api/v1/addresses', addressRouter],
  ['/api/v1/cart', cartRouter],
  ['/api/v1/checkout', checkoutRouter],
  ['/api/v1/orders', ordersRouter],
  ['/api/v1/trials', trialsRouter],
  ['/api/v1/staff', staffRouter],
  ['/api/v1/admin', adminRouter],
];

type RouteLayer = { route?: { path: string; methods: Record<string, boolean> } };

/** Express `/:id` → OpenAPI `/{id}`, and drop the trailing slash of a bare `/`. */
function toOpenApiPath(prefix: string, path: string): string {
  const full = `${prefix}${path}`.replace(/\/:(\w+)/g, '/{$1}');
  return full.length > 1 && full.endsWith('/') ? full.slice(0, -1) : full;
}

/** Every route the app actually serves, as `"method /path"`. */
function realOperations(): string[] {
  const ops: string[] = [];
  for (const [prefix, router] of MOUNTS) {
    // `.stack` is Express internals — the only way to enumerate mounted routes.
    for (const layer of (router as unknown as { stack: RouteLayer[] }).stack) {
      if (!layer.route) continue; // a nested router or plain middleware
      for (const method of Object.keys(layer.route.methods)) {
        ops.push(`${method} ${toOpenApiPath(prefix, layer.route.path)}`);
      }
    }
  }
  return ops;
}

describe('OpenAPI document', () => {
  const doc = getOpenApiDocument();

  const documented = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
    Object.keys(item as object).map((method) => `${method} ${path}`),
  );

  it('documents every route the app serves', () => {
    const undocumented = realOperations().filter((op) => !documented.includes(op));
    expect(undocumented, 'routes with no .openapi.ts entry — add one').toEqual([]);
  });

  it('documents only routes that exist', () => {
    const real = realOperations();
    const phantom = documented.filter((op) => !real.includes(op));
    expect(phantom, 'documented but not served — the spec is lying').toEqual([]);
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
