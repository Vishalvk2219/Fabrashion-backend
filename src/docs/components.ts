import type { ResponseConfig } from '@asteasolutions/zod-to-openapi';

import { z } from '@/lib/zod';
import { registry } from './registry';

/** Minimal shape of a documented response header (a subset of OpenAPI's HeaderObject). */
type ResponseHeaders = Record<
  string,
  { description: string; schema: { type: 'string' | 'integer'; example?: unknown } }
>;

/**
 * Shared response building blocks: the one error envelope the API speaks, the
 * headers it always sends, and ready-made 4xx/5xx responses to spread into a
 * route's `responses` map. Keeping them here means every endpoint documents
 * failure the same way — and that the spec matches `middleware/errorHandler`.
 */

/** Machine-readable `error.code` values, from `lib/errors` + the rate limiter. */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
  'TOO_MANY_REQUESTS',
  'INTERNAL_ERROR',
] as const;

/** The uniform error envelope produced by `middleware/errorHandler`. */
export const errorSchema = registry.register(
  'Error',
  z
    .object({
      error: z.object({
        code: z.enum(ERROR_CODES).openapi({
          description: 'Stable, machine-readable code. Branch on this, never on `message`.',
          example: 'UNAUTHORIZED',
        }),
        message: z.string().openapi({
          description: 'Human-readable explanation. Safe to surface to the user.',
          example: 'Invalid email or password',
        }),
        // `type: 'object'` is set explicitly: an untyped Zod `unknown` emits a
        // bare `nullable: true`, which is invalid in OpenAPI 3.0 without a type.
        details: z.unknown().optional().openapi({
          type: 'object',
          description: 'Optional, code-specific context. See `ValidationError` for the 422 shape.',
        }),
      }),
    })
    .openapi({ description: 'Every non-2xx response from this API uses this envelope.' }),
);

/** 422 body: `details` carries Zod’s flattened field errors. */
export const validationErrorSchema = registry.register(
  'ValidationError',
  z
    .object({
      error: z.object({
        code: z.literal('VALIDATION_ERROR'),
        message: z.string().openapi({ example: 'Validation failed' }),
        details: z.object({
          formErrors: z.array(z.string()).openapi({
            description: 'Errors not attributable to a single field.',
            example: [],
          }),
          fieldErrors: z.record(z.array(z.string())).openapi({
            description: 'Field name → list of messages. Render these next to the input.',
            example: {
              email: ['Enter a valid email'],
              password: ['Password must be at least 8 characters'],
            },
          }),
        }),
      }),
    })
    .openapi({ description: 'Request body failed schema validation.' }),
);

/** Echoed on every response; log it and quote it in bug reports. */
export const requestIdHeader: ResponseHeaders = {
  'x-request-id': {
    description:
      'Correlation id for this request — taken from the inbound `x-request-id` if you send one, otherwise generated. Appears on every log line for the request.',
    schema: { type: 'string', example: '0f5c2f2e-9a1e-4a2b-9c1d-5b8f0a3c7e21' },
  },
};

/** Sent by the auth rate limiter (IETF draft-7). */
export const rateLimitHeaders: ResponseHeaders = {
  RateLimit: {
    description:
      'Remaining quota for the current window, e.g. `limit=30, remaining=27, reset=840`.',
    schema: { type: 'string', example: 'limit=30, remaining=27, reset=840' },
  },
  'RateLimit-Policy': {
    description: 'The policy in force, e.g. `30;w=900` (30 requests per 900s).',
    schema: { type: 'string', example: '30;w=900' },
  },
};

type ErrorExample = { code: (typeof ERROR_CODES)[number]; message: string };

/** Build a documented error response with a realistic example body. */
function errorResponse(description: string, example: ErrorExample): ResponseConfig {
  return {
    description,
    headers: requestIdHeader,
    content: {
      'application/json': {
        schema: errorSchema,
        example: { error: example },
      },
    },
  };
}

export const responses = {
  unauthorized: errorResponse('Missing, malformed, or expired access token.', {
    code: 'UNAUTHORIZED',
    message: 'Missing or malformed Authorization header',
  }),

  forbidden: errorResponse('Authenticated, but your role may not perform this action.', {
    code: 'FORBIDDEN',
    message: 'You do not have permission to do that',
  }),

  notFound: errorResponse('No such route or resource.', {
    code: 'NOT_FOUND',
    message: 'Resource not found',
  }),

  conflict: errorResponse('The request conflicts with existing state.', {
    code: 'CONFLICT',
    message: 'An account with this email or phone already exists',
  }),

  validation: {
    description: 'The request body failed validation. `details.fieldErrors` maps field → messages.',
    headers: requestIdHeader,
    content: {
      'application/json': {
        schema: validationErrorSchema,
        example: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: {
              formErrors: [],
              fieldErrors: {
                email: ['Enter a valid email'],
                phone: ['Enter a valid 10-digit mobile number'],
              },
            },
          },
        },
      },
    },
  } satisfies ResponseConfig,

  tooManyRequests: {
    description:
      'Rate limit exceeded: 30 requests per 15 minutes per IP across the auth endpoints. Back off and retry after `Retry-After` seconds.',
    headers: {
      ...requestIdHeader,
      ...rateLimitHeaders,
      'Retry-After': {
        description: 'Seconds to wait before retrying.',
        schema: { type: 'integer', example: 840 },
      },
    },
    content: {
      'application/json': {
        schema: errorSchema,
        example: {
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many attempts. Please try again later.',
          },
        },
      },
    },
  } satisfies ResponseConfig,

  internal: errorResponse(
    'Unexpected server error. Nothing is leaked; check logs by `x-request-id`.',
    {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    },
  ),
} as const;
