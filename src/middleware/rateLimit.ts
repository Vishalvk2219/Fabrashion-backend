import rateLimit from 'express-rate-limit';

/**
 * Per-IP limiter for auth endpoints (login/register/refresh) to blunt
 * brute-force + credential-stuffing. Memory store is fine for a single
 * instance; swap in a Redis store (`rate-limit-redis`) when scaling out.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again later.' },
  },
});
