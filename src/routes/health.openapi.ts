import { z } from '@/lib/zod';
import { requestIdHeader, responses } from '@/docs/components';
import { API_V1, registry } from '@/docs/registry';

/** OpenAPI description of the unversioned probe routes and the API root. */

const TAG = 'System';

const serviceStatus = z.enum(['up', 'down']);

const healthSchema = registry.register(
  'Health',
  z
    .object({
      status: z.enum(['ok', 'degraded']).openapi({
        description: '`ok` only when every dependency is up; otherwise `degraded`.',
        example: 'ok',
      }),
      uptime: z.number().openapi({
        description: 'Seconds since the process started.',
        example: 1284.51,
      }),
      timestamp: z.string().datetime().openapi({ example: '2026-07-14T09:12:04.512Z' }),
      services: z
        .object({
          db: serviceStatus.openapi({ example: 'up' }),
          redis: serviceStatus.openapi({ example: 'up' }),
        })
        .openapi({ description: 'Per-dependency reachability, each checked with a 2s timeout.' }),
    })
    .openapi({ description: 'Liveness/readiness snapshot.' }),
);

registry.registerPath({
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  tags: [TAG],
  summary: 'Liveness / readiness probe',
  security: [], // public
  description:
    'Reports the reachability of Postgres and Redis.\n\n' +
    'Deliberately returns **200 even when a dependency is down** — the body says `degraded` and names the offender. Probes should therefore assert on `status`, not merely on the HTTP code. Unauthenticated, unversioned, and safe to poll.',
  responses: {
    200: {
      description: 'Always returned, whether healthy or degraded.',
      headers: requestIdHeader,
      content: {
        'application/json': {
          schema: healthSchema,
          examples: {
            healthy: {
              summary: 'All dependencies up',
              value: {
                status: 'ok',
                uptime: 1284.51,
                timestamp: '2026-07-14T09:12:04.512Z',
                services: { db: 'up', redis: 'up' },
              },
            },
            degraded: {
              summary: 'Redis unreachable — still 200',
              value: {
                status: 'degraded',
                uptime: 12.09,
                timestamp: '2026-07-14T09:12:04.512Z',
                services: { db: 'up', redis: 'down' },
              },
            },
          },
        },
      },
    },
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: API_V1,
  operationId: 'getApiRoot',
  tags: [TAG],
  summary: 'API root',
  security: [], // public
  description: 'Identifies the service and the API version served at this prefix.',
  responses: {
    200: {
      description: 'Service identity.',
      headers: requestIdHeader,
      content: {
        'application/json': {
          schema: registry.register(
            'ApiRoot',
            z.object({
              name: z.string().openapi({ example: 'fabrashion-backend' }),
              version: z.string().openapi({ example: 'v1' }),
              status: z.string().openapi({ example: 'ok' }),
            }),
          ),
          example: { name: 'fabrashion-backend', version: 'v1', status: 'ok' },
        },
      },
    },
    500: responses.internal,
  },
});
