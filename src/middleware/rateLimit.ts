import rateLimit from 'express-rate-limit';

import { env } from '@/config/env';

/** Disable limiters under the test runner (many parallel suites share one IP). */
const skip = () => env.isTest;

/**
 * Per-IP limiter for auth endpoints (OTP request/verify/refresh) to blunt
 * brute-force + credential-stuffing. Memory store is fine for a single
 * instance; swap in a Redis store (`rate-limit-redis`) when scaling out.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: {
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again later.' },
  },
});

/**
 * Generous per-IP limiter for public read endpoints (catalog browsing). Guards against scraping
 * without getting in a real shopper's way. Same Redis-store note as above when scaling out.
 */
export const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: {
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please slow down.' },
  },
});
