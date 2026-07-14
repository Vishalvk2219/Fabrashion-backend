import 'dotenv/config';
import { z } from 'zod';

/**
 * Single, validated source of truth for environment configuration.
 * Import `env` anywhere instead of reading `process.env` directly.
 * Invalid/missing required vars fail fast at boot.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Comma-separated origins, or "*" for all (development only).
  CORS_ORIGINS: z.string().default('*'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  // Defaults match docker-compose.yml so local dev/test work without a .env.
  // Ports are non-default (5433/6380) to stay clear of other local projects on 5432/6379.
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://fabrashion:fabrashion@localhost:5433/fabrashion?schema=public'),
  REDIS_URL: z.string().url().default('redis://localhost:6380'),

  // --- Auth (Phase 1) ---
  // Dev defaults keep `npm run dev`/tests zero-config; the prod guard below rejects them.
  JWT_ACCESS_SECRET: z
    .string()
    .min(32)
    .default('dev-access-secret-change-me-please-32chars-min!!'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32)
    .default('dev-refresh-secret-change-me-please-32chars-min!'),
  // jsonwebtoken `expiresIn` format (e.g. "15m", "1h").
  JWT_ACCESS_TTL: z.string().default('15m'),
  // Refresh-token lifetime in days (used to compute the DB `expiresAt`).
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.flatten().fieldErrors;
  // logger depends on env, so we use console here (this runs before logging is set up).
  console.error('❌ Invalid environment variables:\n', JSON.stringify(issues, null, 2));
  process.exit(1);
}

const data = parsed.data;

// Never allow the built-in dev JWT secrets in production.
if (
  data.NODE_ENV === 'production' &&
  (data.JWT_ACCESS_SECRET.startsWith('dev-') || data.JWT_REFRESH_SECRET.startsWith('dev-'))
) {
  console.error('❌ JWT_ACCESS_SECRET / JWT_REFRESH_SECRET must be set to real values in production.');
  process.exit(1);
}

// Mirror resolved values back to process.env so external tooling that reads
// process.env directly (Prisma's `env("DATABASE_URL")`) sees the same values —
// including our local defaults when no .env file is present.
process.env.DATABASE_URL = data.DATABASE_URL;
process.env.REDIS_URL = data.REDIS_URL;

export const env = {
  ...data,
  isProd: data.NODE_ENV === 'production',
  isDev: data.NODE_ENV === 'development',
  isTest: data.NODE_ENV === 'test',
  /** Parsed CORS origins for the `cors` middleware: `*` or an array of origins. */
  corsOrigins: data.CORS_ORIGINS === '*' ? '*' : data.CORS_ORIGINS.split(',').map((o) => o.trim()),
} as const;

export type Env = typeof env;
