import IORedis from 'ioredis';
import { env } from '@/config/env';
import { logger } from '@/lib/logger';

/**
 * Shared Redis client for caching and app use.
 *
 * - `lazyConnect`: we call `.connect()` once at boot; failures are non-fatal.
 * - `enableOfflineQueue: false`: commands fail fast when Redis is down instead
 *   of queueing forever — important so the /health check reflects reality.
 * - ioredis keeps trying to reconnect in the background per `retryStrategy`,
 *   so the client recovers automatically once Redis is back.
 */
export const redis = new IORedis(env.REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

redis.on('error', (err: Error) => {
  logger.warn({ err: err.message }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Redis connected');
});
