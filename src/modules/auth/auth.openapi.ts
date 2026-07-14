import { z } from '@/lib/zod';
import { responses, rateLimitHeaders, requestIdHeader } from '@/docs/components';
import { API_V1, bearerAuth, registry } from '@/docs/registry';
import type { AuthResponseDTO, AuthUserDTO } from './auth.mapper';
import { loginSchema, refreshSchema, registerSchema } from './auth.schema';

/**
 * OpenAPI description of the auth module. Request bodies reuse the very Zod
 * schemas the routes validate with (`auth.schema`), and the response schemas
 * below are `satisfies`-checked against the DTOs `auth.mapper` actually
 * returns — so a shape change that isn't documented fails `npm run typecheck`.
 *
 * This is the template for future modules: one `<module>.openapi.ts` next to
 * the routes, imported for its side effects by `docs/openapi.ts`.
 */

const TAG = 'Auth';

/** Documented `x-request-id` + rate-limit headers, on every auth 2xx. */
const authHeaders = { ...requestIdHeader, ...rateLimitHeaders };

const userExample = {
  id: 'b1d1f0a4-4c9e-4b9a-9c1e-2f3a4b5c6d7e',
  fullName: 'Aarav Sharma',
  email: 'aarav.sharma@example.com',
  phone: '+919876543210',
  role: 'CUSTOMER',
} as const;

const accessTokenExample =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMWQxZjBhNC00YzllLTRiOWEtOWMxZS0yZjNhNGI1YzZkN2UiLCJyb2xlIjoiQ1VTVE9NRVIiLCJpYXQiOjE3NTIzOTA0MDAsImV4cCI6MTc1MjM5MTMwMH0.9x2QpQ0rQ6m2mVQ0F6bqK3nqfQ0X1yQ0m8rQ0y9kQ2s';
const refreshTokenExample = '3f6d1c9a5b8e4d2f7a0c1e9b4d6f8a2c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f';

export const userSchema = registry.register(
  'User',
  z
    .object({
      id: z.string().uuid().openapi({ example: userExample.id }),
      fullName: z.string().openapi({ example: userExample.fullName }),
      email: z.string().email().nullable().openapi({
        description: 'Null for phone-only accounts (Phase 1b).',
        example: userExample.email,
      }),
      phone: z.string().nullable().openapi({
        description: 'E.164, always +91-prefixed. Null for email-only accounts.',
        example: userExample.phone,
      }),
      role: z.enum(['CUSTOMER', 'STAFF', 'ADMIN']).openapi({
        description: 'Authorisation role. Customers may only touch their own resources.',
        example: userExample.role,
      }),
    })
    .openapi({ description: 'The authenticated user. Never contains credentials.' }),
) satisfies z.ZodType<AuthUserDTO>;

const tokenPairShape = {
  accessToken: z.string().openapi({
    description: 'JWT, valid 15 minutes. Send as `Authorization: Bearer <accessToken>`.',
    example: accessTokenExample,
  }),
  refreshToken: z.string().openapi({
    description:
      'Opaque token, valid 30 days, single-use: every refresh rotates it. Store it in secure storage (Keychain / Keystore), never in plain AsyncStorage — and replace it with the one each refresh returns.',
    example: refreshTokenExample,
  }),
};

export const tokenPairSchema = registry.register(
  'TokenPair',
  z
    .object(tokenPairShape)
    .openapi({ description: 'A freshly issued access + refresh token pair.' }),
);

export const authResponseSchema = registry.register(
  'AuthResponse',
  z
    .object({ user: userSchema, ...tokenPairShape })
    .openapi({ description: 'The signed-in user plus a new token pair.' }),
) satisfies z.ZodType<AuthResponseDTO>;

const authResponseExample = {
  user: userExample,
  accessToken: accessTokenExample,
  refreshToken: refreshTokenExample,
};

registry.registerPath({
  method: 'post',
  path: `${API_V1}/auth/register`,
  operationId: 'register',
  tags: [TAG],
  summary: 'Create an account',
  security: [], // public
  description:
    'Registers an email/password account and signs the user straight in — the response already carries a token pair, so no follow-up login call is needed.\n\n' +
    'The phone number is stored (prefixed `+91`) for delivery and the upcoming OTP login; it is not verified yet. Email and phone must both be unused, otherwise 409.',
  request: {
    body: {
      required: true,
      description: 'New account details.',
      content: { 'application/json': { schema: registerSchema } },
    },
  },
  responses: {
    201: {
      description: 'Account created and signed in.',
      headers: authHeaders,
      content: {
        'application/json': { schema: authResponseSchema, example: authResponseExample },
      },
    },
    409: responses.conflict,
    422: responses.validation,
    429: responses.tooManyRequests,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/auth/login`,
  operationId: 'login',
  tags: [TAG],
  summary: 'Sign in with email + password',
  security: [], // public
  description:
    'Exchanges credentials for a token pair.\n\n' +
    'A wrong password and an unknown email return the *same* 401, on purpose: the API will not confirm whether an address is registered.\n\n' +
    'Seeded dev accounts: `customer@shop.test`, `staff@shop.test`, `admin@shop.test` — all with password `Password123!`.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: loginSchema } },
    },
  },
  responses: {
    200: {
      description: 'Signed in.',
      headers: authHeaders,
      content: {
        'application/json': { schema: authResponseSchema, example: authResponseExample },
      },
    },
    401: {
      ...responses.unauthorized,
      description: 'Unknown email or wrong password (deliberately indistinguishable).',
      content: {
        'application/json': {
          schema: responses.unauthorized.content!['application/json']!.schema,
          example: { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } },
        },
      },
    },
    422: responses.validation,
    429: responses.tooManyRequests,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/auth/refresh`,
  operationId: 'refreshTokens',
  tags: [TAG],
  summary: 'Rotate the token pair',
  security: [], // public
  description:
    'Trades a valid refresh token for a brand-new access + refresh pair. Call this when a request fails with 401 because the 15-minute access token expired, then retry the original request.\n\n' +
    '**Rotation is mandatory:** the token you send is revoked immediately, so you must persist the pair this endpoint returns. Replaying an already-rotated token is treated as theft — the entire token family for that user is revoked and every session is signed out. Serialise your refresh calls (one in flight at a time) so two concurrent 401s do not trigger this.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: refreshSchema } },
    },
  },
  responses: {
    200: {
      description: 'A new pair. The refresh token you sent is now dead — store these instead.',
      headers: authHeaders,
      content: {
        'application/json': {
          schema: tokenPairSchema,
          example: { accessToken: accessTokenExample, refreshToken: refreshTokenExample },
        },
      },
    },
    401: {
      ...responses.unauthorized,
      description: 'The refresh token is unknown, expired, or already rotated (family revoked).',
      content: {
        'application/json': {
          schema: responses.unauthorized.content!['application/json']!.schema,
          example: { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired refresh token' } },
        },
      },
    },
    422: responses.validation,
    429: responses.tooManyRequests,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'post',
  path: `${API_V1}/auth/logout`,
  operationId: 'logout',
  tags: [TAG],
  summary: 'Sign out (revoke a refresh token)',
  security: [], // public
  description:
    'Revokes the given refresh token so it can never be rotated again. Idempotent: an unknown or already-revoked token still returns 204, so a client can always sign out cleanly.\n\n' +
    'The access token is *not* revoked — being a stateless JWT it stays valid until it expires (≤15 min). Discard it client-side.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: refreshSchema } },
    },
  },
  responses: {
    204: { description: 'Signed out. No body.', headers: requestIdHeader },
    422: responses.validation,
    500: responses.internal,
  },
});

registry.registerPath({
  method: 'get',
  path: `${API_V1}/auth/me`,
  operationId: 'getCurrentUser',
  tags: [TAG],
  summary: 'Get the signed-in user',
  description:
    'Returns the profile behind the bearer token. Use it to restore a session on app launch and to check whether a stored access token is still good.',
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: 'The authenticated user.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: userSchema, example: userExample } },
    },
    401: responses.unauthorized,
    500: responses.internal,
  },
});
