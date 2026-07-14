import { Router } from 'express';
import { prisma } from '@/config/db';
import { redis } from '@/config/redis';

export const healthRouter = Router();

type ServiceStatus = 'up' | 'down';

/** Race a check against a short timeout so /health always responds quickly. */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function checkDb(): Promise<ServiceStatus> {
  return withTimeout(
    prisma
      .$queryRaw`SELECT 1`.then((): ServiceStatus => 'up')
      .catch((): ServiceStatus => 'down'),
    2000,
    'down',
  );
}

async function checkRedis(): Promise<ServiceStatus> {
  return withTimeout(
    redis
      .ping()
      .then((pong): ServiceStatus => (pong === 'PONG' ? 'up' : 'down'))
      .catch((): ServiceStatus => 'down'),
    2000,
    'down',
  );
}

/**
 * Liveness/readiness probe. Always returns 200 with the real status of each
 * dependency so the app is observable even when a dependency is down.
 */
healthRouter.get('/health', async (_req, res) => {
  const [db, redisStatus] = await Promise.all([checkDb(), checkRedis()]);
  const healthy = db === 'up' && redisStatus === 'up';
  res.status(200).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: { db, redis: redisStatus },
  });
});
